"""fuel_tank_elevated (docs/fuel-tanks.md §5.5): M17 raised twin vertical tanks with the working OIL VALVE.
Footprint 5 x 3 x 6. Six I-section legs with X bracing (ends + north side), ring beams, open grating deck at 2.60 m
with tube rail + toe boards, rung ladder on the south side near +X; two field-grey vertical tanks (Ø 1.90) on ring
skirts with rust-brown cone roofs, mushroom vents, roof manholes; the -X tank's bottom outlet drops down the -X end
leg on clamps to a big gate valve (node `valve`, pivot = handwheel centre, spins about its stem) and a spout
(anchor `spout`) pointing -X, drip stain below. destroyed: -X legs buckled, deck tilted ~20°, the -X tank toppled
against the rail and split, the other scorched upright, valve pipe torn, scorch."""
import math, random
import ft
from ft import K, C, V, bmn, P, PAL

W, D, DECK = 5.0, 3.0, 2.60
TR, TZ1, ROOF = 0.95, 5.00, 0.35
XS = (-1.15, 1.15)
TILT = math.radians(15)            # wreck: the -X half of the deck folds down at the middle legs (x = 0)
SPOUT_X = -3.02                    # spout tip: within 0.5 m of the M17 VALVE point (3.5 m along -X from the centre)


def fold(p):
    """Wreck transform of a point on/over the deck: the -X half rotates down about the line x = 0, z = DECK."""
    p = V(p)
    if p.x >= 0:
        return p
    return ft.rot_about((0, 0, DECK), -TILT, 'Y') @ p


def tank(shell, roof, fit, bolts, x, dest_split=False, seed=0):
    up = V((0, 0, 1))
    ft.stack_bm(shell, (x, 0, DECK + 0.12), up, [(0, 0.0), (0, TR), (TZ1 - DECK - 0.12, TR)], 28)
    ft.stack_bm(roof, (x, 0, TZ1), up, [(0, TR + 0.03), (0.04, TR + 0.03), (ROOF, 0.18), (ROOF + 0.02, 0.0)], 28)
    vax = ft.Ax((x, 0, (DECK + TZ1) / 2), (0, 0, 1))
    zc = (DECK + TZ1) / 2
    for z in (DECK + 0.9, DECK + 1.7):
        ft.band_bm(fit, vax, z - zc, TR, w=0.05, proud=0.01, segs=28)
    for k in range(4):
        ft.long_seam_bm(fit, vax, DECK + 0.15 - zc, TZ1 - 0.05 - zc, TR, k * math.pi / 2 + 0.4)
    ft.stack_bm(fit, (x, 0, DECK + 0.002), up, [(0, TR + 0.04), (0.118, TR + 0.04), (0.118, 0.0)], 28)    # ring skirt
    ft.vent(fit, V((x, 0, TZ1 + ROOF - 0.02)), up, h=0.42)
    ft.manhole(fit, bolts, V((x + 0.45, -0.2, TZ1 + ROOF * 0.52)), (0.25, -0.1, 1), r=0.2, neck=0.08, nb=8)


def build(out, asset, dest, seed):
    K.begin(asset + ('_destroyed' if dest else ''), seed, theater='temperate')
    r = random.Random(seed)
    grey = PAL['fieldgrey'] if not dest else ft.BURNT
    rust = PAL['rustroof'] if not dest else ft.BURNT_RUST
    smat = 'paint_metal' if not dest else ft.BURNT_MAT
    hw, hd = W / 2 - 0.12, D / 2 - 0.12
    legs, beams, br, deck, rail, toe, ld = bmn(), bmn(), bmn(), bmn(), bmn(), bmn(), bmn()
    cols = [(x, y) for x in (-hw, 0.0, hw) for y in (-hd, hd)]
    for (x, y) in cols:
        top = DECK - 0.2
        if dest and x < -1:                                                # buckled: kinked, meets the folded deck
            tp = fold(V((x, y, top)))
            k1 = V((x - 0.18, y * 0.95, 0.85))
            ft.ibeam(legs, (x, y, 0), k1, h=0.18, b=0.16, up=(1, 0, 0))
            ft.ibeam(legs, k1, tp, h=0.18, b=0.16, up=(1, 0, 0))
        else:
            ft.ibeam(legs, (x, y, 0), (x, y, top), h=0.18, b=0.16, up=(1, 0, 0))
        C.box_bm(legs, (x, y, 0.1), (0.4, 0.4, 0.2))                       # concrete footing
    for y in (-hd, hd):                                   # (split at x = 0 so the wreck can fold there)
        ft.ibeam(beams, (-hw - 0.09, y, DECK - 0.13), (0.0, y, DECK - 0.13), h=0.18, b=0.12)
        ft.ibeam(beams, (0.0, y, DECK - 0.13), (hw + 0.09, y, DECK - 0.13), h=0.18, b=0.12)
    for x in (-hw, -hw / 2, 0.0, hw / 2, hw):
        ft.ibeam(beams, (x, -hd - 0.06, DECK - 0.13), (x, hd + 0.06, DECK - 0.13), h=0.18, b=0.1)
    for x in (-hw, hw):                                    # X bracing: both ends + the north side
        if dest and x < 0:
            continue
        ft.flatbar(br, (x, -hd, 0.3), (x, hd, DECK - 0.3), normal=(1, 0, 0))
        ft.flatbar(br, (x, hd, 0.3), (x, -hd, DECK - 0.3), normal=(1, 0, 0))
    for (x0, x1) in ((-hw, 0.0), (0.0, hw)):
        if dest and x0 < 0:
            continue                                      # the -X bay's bracing tore when the legs buckled
        ft.flatbar(br, (x0, hd, 0.3), (x1, hd, DECK - 0.3), normal=(0, 1, 0))
        ft.flatbar(br, (x1, hd, 0.3), (x0, hd, DECK - 0.3), normal=(0, 1, 0))
    gb = bmn()
    C.box_bm(gb, (-W / 4, 0, DECK - 0.02), (W / 2, D, 0.04))      # two panels (the wreck folds between them)
    C.box_bm(gb, (W / 4, 0, DECK - 0.02), (W / 2, D, 0.04))
    lx = hw - 0.55
    e = [(-W / 2 + 0.03, -D / 2 + 0.03), (W / 2 - 0.03, -D / 2 + 0.03), (W / 2 - 0.03, D / 2 - 0.03), (-W / 2 + 0.03, D / 2 - 0.03)]
    ft.railing(rail, [(lx + 0.3, e[0][1]), e[1], e[2], (0.0, e[2][1]), e[3], e[0], (0.0, e[0][1]), (lx - 0.3, e[0][1])], DECK, h=1.0,
               step=1.2, r=0.022, toe=(toe, 0.1))
    ft.ladder(ld, (lx, -D / 2 - 0.1, 0.0), DECK, (0, -1, 0), w=0.45, over=1.0)
    K.ladder_meta((lx, -D / 2 - 0.6, 0), (lx, -D / 2 + 0.4, DECK), DECK)
    deck_parts = [P(gb, 'fuel_grating', 'deck', grime=0.2), P(rail, 'steel_galv', 'rails', mat_tint=(0.45, 0.45, 0.43)),
                  P(toe, 'paint_metal', 'toe_boards', mat_tint=PAL['blackgrey']), P(beams, 'paint_metal', 'beams', mat_tint=PAL['blackgrey'])]
    P(legs, 'paint_metal', 'legs', mat_tint=PAL['blackgrey'], grime=0.7)
    P(br, 'paint_metal', 'bracing', mat_tint=PAL['blackgrey'])
    P(ld, 'paint_metal', 'ladder', mat_tint=PAL['blackgrey'])
    S = ft.NS(r=r, dest=dest, seed=seed, grey=grey, rust=rust, smat=smat, deck_parts=deck_parts, hw=hw, hd=hd, lx=lx)
    tanks(S)
    valve(S)
    dress(S)
    K.footprint_rect(0, 0, W, D, 0, 'HIGH', 'tank')
    for (x, y) in cols:
        K.footprint_rect(x, y, 0.3, 0.3, 0, 'HIGH', 'post')
    K.anchor('blast_origin', (0, 0, 3.8), (0, -1, 0), radius=4.0, size=[W, D, 5.8])
    if not dest:
        K.roof_meta([e[0], e[1], e[2], e[3]], DECK, walkable=True, kind='deck')
        K.anchor('explosive_target', (0, -D / 2 - 0.3, 1.0), (0, -1, 0), kind='fuel_tank', chain_radius=8.0)
    ov = [(('tank_shells', 'tank_roofs', 'tank_fittings', 'shell_inside'), ('deck', 'rails', 'toe_boards', 'beams', 'legs', 'bracing', 'ladder'))] if dest else []
    return ft.finalize(out, 'temperate', bounds=(W, D, 6.0), overlaps=ov)


def tanks(S):
    shell, roof, fit, bolts = bmn(), bmn(), bmn(), bmn()
    for i, x in enumerate(XS):
        n0 = (len(shell.verts), len(roof.verts), len(fit.verts), len(bolts.verts))
        tank(shell, roof, fit, bolts, x, seed=S.seed + i)
        if S.dest and i == 0:                   # split on its camera side, then it goes down with the folded deck half
            shell.verts.index_update()
            shell.faces.ensure_lookup_table()
            kill = [f for f in shell.faces if all(v.index >= n0[0] for v in f.verts)]
            kill = [f for f in kill if -2.05 < math.atan2(f.calc_center_median().y, f.calc_center_median().x - x) < -1.05
                    and f.calc_center_median().z > DECK + 0.7 + 0.4 * S.r.random()]
            ft.bmesh.ops.delete(shell, geom=kill, context='FACES')
            M = ft.rot_about((0, 0, DECK), -TILT, 'Y')
            for bm, k in zip((shell, roof, fit, bolts), n0):
                ft.xform_new(bm, k, M)
    if S.dest:
        inner = bmn()
        tank(inner, bmn(), bmn(), bmn(), XS[0])
        inner.faces.ensure_lookup_table()
        kill = [f for f in inner.faces if -2.05 < math.atan2(f.calc_center_median().y, f.calc_center_median().x - XS[0]) < -1.05
                and f.calc_center_median().z > DECK + 0.9]
        ft.bmesh.ops.delete(inner, geom=kill, context='FACES')
        ft.xform_new(inner, 0, ft.rot_about((0, 0, DECK), -TILT, 'Y'))
        P(ft.inner_skin(inner), ft.BURNT_MAT, 'shell_inside', mat_tint=ft.BURNT_RUST)
    P(shell, S.smat, 'tank_shells', smooth=True, mat_tint=S.grey, grime=0.7, lod='keep')
    P(roof, S.smat, 'tank_roofs', smooth=True, mat_tint=S.rust, grime=0.8)
    P(fit, S.smat, 'tank_fittings', smooth=True, mat_tint=tuple(c * 0.9 for c in S.grey), grime=0.7)
    P(bolts, 'cast_iron', 'bolts')
    vax = ft.Ax((XS[1], 0, (DECK + TZ1) / 2), (0, 0, 1))
    if not S.dest:
        ft.stencil('kraftstoff', vax, TR, 0.35, -1.57, 0.26, mode='around')
    r = S.r
    for x in XS:
        if S.dest and x < 0:
            continue
        v = ft.Ax((x, 0, (DECK + TZ1) / 2), (0, 0, 1))
        for k in range(5):
            ft.wrap_decal('rust_run', v, TR, 0.6 + r.uniform(-0.2, 0.3), r.uniform(-math.pi, math.pi), 1.4, 0.35, alpha=0.6, vert=True)
        if S.dest:
            for k in range(4):
                ft.wrap_decal('soot_a', v, TR, r.uniform(-0.8, 0.8), r.uniform(-math.pi, math.pi), 1.2, 1.0, alpha=0.6, vert=True)
    if S.dest:                                   # fold the deck parts (grating, rails, toe boards, beams) at x = 0
        for o in S.deck_parts:
            if o:
                for vv in o.data.vertices:
                    vv.co = fold(vv.co)
                o.data.update()


def valve(S):
    """Bottom outlet of the -X tank -> through the deck -> along under it to the -X end -> down a pipe post outside the
    -X end (on the centre line, on clamps) to a big gate valve with a Ø 0.40 handwheel facing the camera (node
    `valve`) -> spout pointing -X (anchor `spout`, tip SPOUT_X: within 0.5 m of the M17 VALVE point)."""
    pipe, clamps, vb, vw = bmn(), bmn(), bmn(), bmn()
    xo, yo = XS[0] - 0.55, -0.3
    px, py = -W / 2 - 0.12, 0.0
    zv, zs = 1.0, 0.55
    run = [(xo, yo, DECK + 0.16), (xo, yo, DECK - 0.32), (xo, py, DECK - 0.32), (px, py, DECK - 0.32), (px, py, zv + 0.25)]
    if S.dest:                                            # torn: the upper run went down with the deck
        for a, b in zip(run[:3], run[1:4]):
            C.cyl_bm(pipe, fold(a), fold(b), 0.06, 10)
        C.cyl_bm(pipe, (px, py, zv + 0.25), (px + 0.05, py - 0.08, 1.7), 0.06, 10)
    else:
        for a, b in zip(run[:-1], run[1:]):
            C.cyl_bm(pipe, a, b, 0.06, 10)
    C.box_bm(clamps, (px, py + 0.2, 0.9), (0.08, 0.08, 1.8))                  # pipe post on a footing
    C.box_bm(clamps, (px, py + 0.2, 0.08), (0.3, 0.3, 0.16))
    for z in (0.6, 1.5) if S.dest else (0.6, 1.5, 2.1):
        C.box_bm(clamps, (px, py + 0.1, z), (0.12, 0.22, 0.05))
    c = V((px, py, zv))
    C.cyl_bm(vb, c - V((0, 0, 0.2)), c + V((0, 0, 0.2)), 0.09, 12)          # body + flanges
    for s in (-1, 1):
        C.cyl_bm(vb, c + V((0, 0, s * 0.2)), c + V((0, 0, s * 0.25)), 0.13, 12)
    C.cyl_bm(vb, c, c + V((0, -0.32, 0)), 0.07, 10)                         # bonnet toward the camera
    C.cyl_bm(vb, c + V((0, -0.32, 0)), c + V((0, -0.46, 0)), 0.022, 6)
    wc = c + V((0, -0.46, 0))
    ft.handwheel(vw, wc, (0, -1, 0), r=0.2, t=0.02, spokes=5)
    spout = V((SPOUT_X, py, zs))
    C.cyl_bm(pipe, c - V((0, 0, 0.25)), V((px, py, zs)), 0.06, 10)
    C.cyl_bm(pipe, V((px, py, zs)), spout + V((0.05, 0, 0)), 0.06, 10)
    C.cyl_bm(pipe, spout + V((0.05, 0, 0)), spout, 0.085, 10)
    dark = PAL['blackgrey'] if not S.dest else ft.BURNT
    P(pipe, 'paint_metal' if not S.dest else ft.BURNT_MAT, 'oil_pipe', smooth=True, mat_tint=dark)
    P(clamps, 'cast_iron', 'pipe_clamps')
    P(vb, 'paint_metal' if not S.dest else ft.BURNT_MAT, 'valve_body', smooth=True, mat_tint=dark)
    o = P(vw, 'paint_metal', 'valve_wheel', mat_tint=PAL['red'] if not S.dest else (0.3, 0.12, 0.1), node='valve')
    o['kit_pivot'] = [wc.x, wc.y, wc.z]
    K.anchor('valve', tuple(wc), (0, -1, 0), axis=[0, -1, 0], radius=0.2, node='valve')
    K.anchor('spout', tuple(spout), (-1, 0, 0))
    ft.decal('oil_stain', (spout.x + 0.15, spout.y, 0.012), (0, 0, 1), 0.9, 0.7, alpha=0.7)


def dress(S):
    r = S.r
    ft.drums([(0.6, 0.35, 0.0, False, 0), (1.25, 0.4, 0.0, False, 0)] if not S.dest else [(0.6, 0.35, 0.0, True, 0.4)], 'temperate',
             seed=S.seed, burst=S.dest)
    if not S.dest:
        ft.sign_board((0.0, -S.hd - 0.13, 1.4), (0, -1, 0), 0.7)
    else:
        ft.scorch((0, 0, 0), W + 0.5, D + 0.5, seed=S.seed, z=0.01)
        K.anchor('fire', (-1.4, -0.3, 0.6), (0, -1, 0), size=2.2)
        K.anchor('fire', (0.8, 0.0, 3.2), (0, -1, 0), size=1.6)
