"""fuel_tank_quay_12 / _11 (docs/fuel-tanks.md §5.3): M13 harbour bunker-oil tank, footprint 12|11 x 4.5 x 5 m.
Teal grey-green Kriegsmarine tank (Ø 3.40, 2:1 dished heads) on three angle-iron A-frame trestle bents with curved
cradle plates on concrete pads, crown catwalk with a low rail and transverse stubs (two tanks 5 m apart read as one
bridged catwalk), radial-ribbed manhole, flame-arrestor vent, filler, gauge board, caged ladder + landing at the +X
head, bottom outlets -> gate valves -> bunkering hoses on timber rests, salt rime, rust runs, soot blotches.
destroyed: crown burst with petals, far head off, shell sagging off the middle bent, catwalk hanging, scorch."""
import math, random
import ft
from ft import K, C, V, bmn, P, PAL

SIZES = {'fuel_tank_quay_12': dict(W=12.0, LC=10.0), 'fuel_tank_quay_11': dict(W=11.0, LC=9.2)}
D, H, R, HD, CZ = 4.5, 5.0, 1.7, 0.6, 2.6
DECK = 4.40
CRUSH = 0.3                     # wreck: the +X bent's cradle bent down this much


def build(out, asset, dest, seed):
    g = SIZES[asset]
    W, LC = g['W'], g['LC']
    K.begin(asset + ('_destroyed' if dest else ''), seed, theater='coast')
    r = random.Random(seed)
    ax = ft.Ax((0, 0, CZ), (1, 0, 0))
    teal = PAL['teal'] if not dest else ft.BURNT
    smat = 'paint_metal' if not dest else ft.BURNT_MAT
    shell, seams, fit, bolts = bmn(), bmn(), bmn(), bmn()
    hole = (-1.0, 1.6, -0.8, 0.9) if dest else None
    ft.shell_bm(shell, ax, R, LC, HD, segs=36, courses=12 if dest else 6, open_top=hole, ragged=0.5, seed=seed,
                drop_head=-1 if dest else 0)
    tilt = []
    if dest:
        tilt.append(P(ft.inner_skin(shell), ft.BURNT_MAT, 'shell_inside', mat_tint=ft.BURNT_RUST))
    for k in range(7):
        ft.band_bm(seams, ax, -LC / 2 + LC * k / 6, R, segs=36)
    for k in range(6):
        if not dest or not (-1.5 < -LC / 2 + LC * (k + 0.5) / 6 < 2.1):
            ft.long_seam_bm(seams, ax, -LC / 2 + LC * k / 6 + 0.03, -LC / 2 + LC * (k + 1) / 6 - 0.03, R, 0.6 if k % 2 else -0.9)
    s_man, s_vent, s_fill = -2.2, 3.4, 1.2
    ft.manhole(fit, bolts, ax.p(s_man, 0.42, R), ax.dir(0.42), r=0.35, neck=0.15, radial=True)
    ft.vent(fit, ax.p(s_vent, 0.4, R), ax.dir(0.4), h=0.55)
    ft.filler(fit, ax.p(s_fill, 0.45, R), ax.dir(0.45))
    tilt += [P(shell, smat, 'shell', smooth=True, mat_tint=teal, grime=0.6, lod='keep'),
             P(seams, smat, 'seams', mat_tint=tuple(c * 0.93 for c in teal), grime=0.5),
             P(fit, smat, 'fittings', smooth=True, mat_tint=tuple(c * 0.85 for c in teal), grime=0.8),
             P(bolts, 'cast_iron', 'bolts')]
    S = ft.NS(W=W, LC=LC, ax=ax, r=r, dest=dest, seed=seed, tilt=tilt, hole=hole, s_man=s_man)
    trestles(S)
    access(S)
    bunkering(S)
    weather(S)
    if dest:
        wreck(S)
    K.footprint_rect(0, 0, W, D, 0, 'HIGH', 'tank')
    K.anchor('blast_origin', (0, 0, CZ), (0, -1, 0), radius=6.5, size=[LC + 2 * HD, 2 * R, CZ + R])
    if not dest:
        K.anchor('explosive_target', (0, -R - 0.3, 1.0), (0, -1, 0), kind='fuel_tank', chain_radius=10.0)
        K.anchor('catwalk', (0, 0.0, DECK), (0, -1, 0), y=DECK, walkable=False)
    C.A.meta['notes'].append('fuel tank quay (docs/fuel-tanks.md §5.3), +X long axis, ladder at the +X head')
    ov = [(('blown_head',), ('shell', 'seams', 'fittings')),
          (('shell', 'blown_head', 'petals', 'fittings', 'seams', 'shell_inside'), ('trestles', 'cradles', 'pads', 'catwalk', 'brackets',
           'rails', 'ladder', 'cage', 'gauge_board'))] if dest else []
    return ft.finalize(out, 'coast', bounds=(W, D, H), overlaps=ov)


def trestles(S):
    """Three angle-iron A-frame bents with curved cradle plates, diagonal bracing, concrete pads in the setts."""
    LC = S.LC
    st, cr, pad = bmn(), bmn(), bmn()
    zc = CZ - R                                           # shell bottom 0.9
    for k, f in enumerate((0.2, 0.5, 0.8)):
        x = -LC / 2 + LC * f
        if S.dest and k < 2:                              # middle + far bents buckled: legs folded flat on the pads
            for sy in (-1, 1):
                C.box_bm(pad, (x, sy * 1.25, 0.06), (0.6, 0.6, 0.12))
                for j, (dx, a) in enumerate(((0.0, 0.5), (0.3, -0.6))):
                    c = V((x + dx, sy * (1.35 + 0.15 * j), 0.17))
                    d = V((math.cos(a), sy * math.sin(a) * 0.4, 0)).normalized()
                    ft.dz.angle_bm(st, tuple(c - d * 0.55), tuple(c + d * 0.55), w=0.1, t=0.012)
            continue
        n0, n1 = len(st.verts), len(cr.verts)
        for sy in (-1, 1):
            C.box_bm(pad, (x, sy * 1.25, 0.06), (0.6, 0.6, 0.12))
            top = V((x, sy * 0.9, zc - 0.25))
            ft.dz.angle_bm(st, (x, sy * 1.25, 0.12), top, w=0.1, t=0.012)
            ft.dz.angle_bm(st, (x + 0.35, sy * 1.25, 0.12), top + V((0.05, 0, 0)), w=0.08, t=0.01)
            ft.dz.angle_bm(st, (x - 0.35, sy * 1.25, 0.12), top - V((0.05, 0, 0)), w=0.08, t=0.01)
        top_d = CRUSH                                     # dest: the +X bent's cradle bent down under the falling shell
        C.beam_bm(st, (x, -1.25, 0.45), (x, 1.25, 0.45), 0.08, 0.08)
        ft.flatbar(st, (x, -1.2, 0.2), (x, 1.2, zc), normal=(1, 0, 0))
        ft.arc_block(cr, x - 0.2, x + 0.2, 0.0, CZ, R, 1.05, zc - 0.25)
        if S.dest:
            for v in cr.verts[n1:]:
                v.co.z -= top_d
            for v in st.verts[n0:]:
                if v.co.z > 0.5:
                    v.co.z -= top_d * min(1.0, (v.co.z - 0.5) / (zc - 0.75))
    P(st, 'paint_metal', 'trestles', mat_tint=PAL['blackgrey'], grime=0.7)
    P(cr, 'paint_metal', 'cradles', mat_tint=PAL['blackgrey'], grime=0.6)
    P(pad, 'concrete_slab', 'pads', mat_tint=(0.8, 0.78, 0.74))


def access(S):
    """Crown catwalk (planks on brackets) with a 0.6 m rail on the north side + transverse stubs at mid-length,
    landing + caged ladder at the +X head."""
    LC, r = S.LC, S.r
    y0, y1 = -0.15, 0.45
    xa, xb = -LC / 2 + 0.4, LC / 2 - 0.1
    deck, brk, rail, ld, cage = bmn(), bmn(), bmn(), bmn(), bmn()
    gap = (S.hole[0] - 0.8, S.hole[1] + 0.8) if S.dest else (1e9, 1e9)   # torn away over the burst
    if not S.dest:
        ft.plank_deck(deck, xa, xb, y0, y1, DECK, along='x', seed=S.seed)
        ft.plank_deck(deck, -0.3, 0.3, y0 - 0.25, y0, DECK, along='y', seed=S.seed + 1)        # transverse stubs
        ft.plank_deck(deck, -0.3, 0.3, y1, y1 + 0.25, DECK, along='y', seed=S.seed + 2)
    else:
        k, x = 0, xa
        while x < xb - 0.05:
            L = min(xb - x, r.uniform(0.7, 1.4))
            if k % 3 != 1 and (x + L < gap[0] or x > gap[1]):
                ft.plank_deck(deck, x, x + L, y0, y1, DECK, along='x', seed=S.seed + k)
            x += L
            k += 1
    for x in [xa + 0.3 + k * 1.5 for k in range(int((xb - xa) / 1.5) + 1)]:
        if gap[0] - 0.1 < x < gap[1] + 0.1:
            continue
        for yy in (y0 + 0.05, y1 - 0.05):
            zs = CZ + math.sqrt(R * R - (abs(yy) - 0.026) ** 2) + 0.004
            C.box_bm(brk, (x, yy, (zs + DECK - 0.05) / 2), (0.05, 0.05, max(0.02, DECK - 0.05 - zs)))
    apex = LC / 2 + HD
    lx0, lx1 = LC / 2 - 0.1, apex + 0.3
    ft.plank_deck(deck, lx0, lx1, -0.35, 0.45, DECK, along='y', seed=S.seed + 3)
    for (x, y) in ((lx1 - 0.05, -0.3), (lx1 - 0.05, 0.4)):          # landing hangers down to the head
        C.box_bm(brk, (x, y, (DECK - 0.05 + CZ + 0.6) / 2), (0.05, 0.05, DECK - 0.05 - CZ - 0.6))
        rr = math.hypot(0.3, y * 0.6) / R                   # hanger foot just proud of the dished head surface
        C.beam_bm(brk, (x, y, CZ + 0.62), (LC / 2 + HD * math.sqrt(max(0.0, 1 - rr * rr)) + 0.05, y * 0.6, CZ + 0.3), 0.05, 0.05)
    if not S.dest:
        ft.railing(rail, [(xa, y1 + 0.02), (lx1, y1 + 0.02), (lx1, 0.1)], DECK, h=0.57, step=1.5, r=0.022)
    else:
        ft.railing(rail, [(xa, y1 + 0.02), (gap[0], y1 + 0.02)], DECK, h=0.45, step=1.5, r=0.022)
        ft.railing(rail, [(gap[1], y1 + 0.02), (lx1, y1 + 0.02), (lx1, 0.1)], DECK, h=0.5, step=1.5, r=0.022)
    ft.railing(rail, [(lx0, -0.37), (lx1, -0.37)], DECK, h=0.57, step=0.6, r=0.022)
    ft.ladder(ld, (lx1 + 0.08, -0.12, 0.0), DECK, (1, 0, 0), w=0.45, over=0.55)   # no cage: it would overhang the end
    K.ladder_meta((lx1 + 0.7, -0.12, 0), (lx1 - 0.3, -0.12, DECK), DECK)
    S.catwalk = [P(deck, 'boards_weathered', 'catwalk', uv='beam', axis=(0, 1, 0), mat_tint=(0.75, 0.72, 0.68)),
                 P(brk, 'paint_metal', 'brackets', mat_tint=PAL['blackgrey']),
                 P(rail, 'steel_galv', 'rails', mat_tint=(0.6, 0.6, 0.58))]
    P(ld, 'paint_metal', 'ladder', mat_tint=PAL['blackgrey'])
    P(cage, 'paint_metal', 'cage', mat_tint=PAL['blackgrey'])
    gb = bmn()                                                         # gauge board at the -X head
    gx = -apex - 0.3
    C.box_bm(gb, (gx, -0.9, 1.6), (0.06, 0.32, 3.0))
    C.box_bm(gb, (gx, -0.9, 0.06), (0.4, 0.5, 0.12))
    C.cyl_bm(gb, (gx, -0.9, 3.15), (gx + 0.55, -0.9, CZ + R * 0.75), 0.008, 4)
    C.cyl_bm(gb, (gx - 0.03, -0.85, 3.12), (gx + 0.03, -0.85, 3.12), 0.07, 10)
    C.box_bm(gb, (gx - 0.04, -0.9, 1.9), (0.03, 0.12, 0.08))
    P(gb, 'paint_metal', 'gauge_board', mat_tint=(0.95, 0.93, 0.86), grime=0.6)


def bunkering(S):
    """Bottom outlets at both heads -> gate valves -> black rubber bunkering hoses snaking along the south edge."""
    LC, r = S.LC, S.r
    pipe, wheel, hose, rest = bmn(), bmn(), bmn(), bmn()
    for sg in (-1, 1):
        so = sg * (LC / 2 + 0.25)
        ro = R * math.sqrt(1 - (0.25 / HD) ** 2) * 0.8
        p0 = ft.V((so, -0.3, CZ - ro))
        e = ft.V((so + sg * 0.25, -0.3, 0.55))
        C.cyl_bm(pipe, p0, ft.V((p0.x, p0.y, 0.55)), 0.07, 10)
        C.cyl_bm(pipe, ft.V((p0.x, p0.y, 0.55)), e + ft.V((0, -0.9, 0)), 0.07, 10)
        ft.gate_valve(pipe, wheel, (p0.x, -0.75, 0.55), (0, 1, 0), r_pipe=0.07)
        h0 = e + ft.V((0, -0.95, 0))
        pts = [h0, h0 + ft.V((-sg * 0.4, -0.5, -0.45))]
        for k in range(5):
            pts.append(ft.V((h0.x - sg * (0.9 + k * 0.9), -1.85 - 0.3 * math.sin(k * 1.7), 0.08)))
        ft.hose_run(hose, pts, rr=0.075)
        for q in pts[2::2]:
            C.box_bm(rest, (q.x, q.y, 0.03), (0.16, 0.5, 0.06))
    P(pipe, 'paint_metal', 'outlets', smooth=True, mat_tint=PAL['blackgrey'])
    P(wheel, 'paint_metal', 'valves', mat_tint=PAL['red'])
    P(hose, 'bitumen_felt', 'hoses', smooth=True, grime=0)
    P(rest, 'timber_beam', 'hose_rests', uv='beam', axis=(0, 1, 0), mat_tint=(0.7, 0.62, 0.52))
    K.anchor('spout', (LC / 2 + 0.5, -2.0, 0.1), (1, 0, 0))


def weather(S):
    ax, r, LC = S.ax, S.r, S.LC
    if not S.dest:
        ft.stencil('heizoel', ax, R, -1.6, 1.0, 0.45)
        ft.stencil('behaelter_1' if S.W > 11.5 else 'behaelter_2', ax, R, -1.6, 1.32, 0.26, alpha=0.8)
        ft.stencil('feuergefaehrlich', ax, R, 2.4, 1.1, 0.26, alpha=0.8)
        ft.stencil('heizoel', ax, R, 0.0, -1.0, 0.45, flip=True, alpha=0.8)
    for k in range(9):
        ft.wrap_decal('streak_rust', ax, R, r.uniform(-LC / 2 + 0.4, LC / 2 - 0.4), r.choice((-1, 1)) * r.uniform(0.6, 1.3), 0.4, 1.3, alpha=0.65)
    for k in range(3 if not S.dest else 9):          # the original paints soot blotches even on intact tanks
        ft.wrap_decal('soot_a', ax, R, r.uniform(-LC / 2 + 1, LC / 2 - 1), r.uniform(0.2, 1.2), r.uniform(1.0, 1.8), r.uniform(0.8, 1.4), alpha=0.45)
    for sg in (-1, 1):                                # salt rime on the lower third
        for k in range(4):
            ft.wrap_decal('efflorescence', ax, R, -LC / 2 + 1.2 + k * (LC - 2.4) / 3, sg * 2.0, 2.6, 1.0, alpha=0.5)


def wreck(S):
    """Crown burst with petals; the middle and far bents buckle so the shell pivots on the +X bent's cradle and its far
    (-X) end comes down to the setts; the far head blown open on a twisted hinge (south side, swung back along the
    flank: the quay leaves no room to lie it beyond the end); catwalk torn away over the burst, the rest rolls; soot."""
    ax, r, LC = S.ax, S.r, S.LC
    pet = bmn()
    hs, he = S.hole[0], S.hole[1]
    ft.petals(pet, ax, R, (hs + he) / 2, 0.05, he - hs, 2.2, n=10, curl=0.7, seed=S.seed)
    S.tilt.append(P(pet, ft.BURNT_MAT, 'petals', mat_tint=ft.BURNT_RUST, grime=0.9))
    hd = bmn()
    xf = -LC / 2
    ft.dish(hd, (xf, 0.0, CZ), (-1, 0, 0), R * 0.99, HD)
    ft.xform_new(hd, 0, ft.Matrix.Translation((0, -HD - 0.04, 0)))           # standing on its rim against the flank
    ft.xform_new(hd, 0, ft.rot_about(V((xf, -R - HD - 0.06, CZ)), -math.radians(91), 'Z'))
    ft.xform_new(hd, 0, ft.Matrix.Translation((0, 0, -(CZ - R * 0.99) + 0.03)))   # on the ground (not sagged)
    P(hd, ft.BURNT_MAT, 'blown_head', mat_tint=ft.BURNT, grime=0.9)
    xp = -LC / 2 + LC * 0.8 - 0.2                         # inner edge of the +X cradle
    piv = V((xp, 0, CZ - R))
    a = math.asin((CZ - R - CRUSH - 0.03) / (xp + LC / 2))       # the +X cradle is bent down CRUSH too, so the
    M = (ft.Matrix.Translation((0, 0, -CRUSH)) @ ft.Matrix.Translation(piv) @ ft.Matrix.Rotation(-a, 4, 'Y')
         @ ft.Matrix.Translation(-piv))                          # +X end comes down instead of see-sawing up
    for o in S.tilt:
        if o:
            o.data.transform(M)
    for o in list(C.A.parts):                             # shell decals sag with it
        if o.name in ft.bpy.data.objects and o.name.split('.')[0].startswith(('wd_', 'streak')):
            o.data.transform(M)
    y0 = -0.15
    for o in S.catwalk:
        if not o:
            continue
        brk = o.name.split('.')[0] == 'brackets'
        for v in o.data.vertices:
            p = M @ V(v.co)
            t = max(0.0, min(1.0, (xp - p.x) / (xp + LC / 2)))
            tw = -0.1 * t if not brk else 0.0
            q = V((0, p.y - y0, p.z - DECK))
            c, s_ = math.cos(tw), math.sin(tw)
            v.co = (p.x, y0 + q.y * c - q.z * s_, DECK + q.y * s_ + q.z * c)
        o.data.update()
    ft.scorch((0, 0, 0), S.W * 0.95, D * 0.9, seed=S.seed, z=0.01)
    for k in range(4):
        o = ft.wrap_decal('stain_rust_blotch', ax, R, r.uniform(hs - 0.3, he + 0.3), r.choice((-1, 1)) * r.uniform(0.9, 1.2), 0.8, 0.7, alpha=0.7)
        o and o.data.transform(M)
    for k, s in enumerate((-2.5, 0.5, 3.2)):
        p = M @ ax.p(s, 0.0, 0.4)
        K.anchor('fire', (p.x, p.y, p.z), (0, -1, 0), size=2.6)
