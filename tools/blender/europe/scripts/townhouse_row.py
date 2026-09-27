"""Belgian / northern French brick townhouse row (terraced, c. 1880-1930): 3 houses with individually varied facades.
Rework 1 (art director): deep window reveals, crow-stepped gables with projecting stone copings + kneelers and a real
attic hatch with hoist beam, parapeted party walls with copings / lead flashing / shared chimney stacks, per-house roof
tone + ridge tiles + dormer and chimney rhythm, detailed rear elevations (bands, sills, back extensions, downpipes),
exposed end party wall with chimney breast, tie-irons and a ghost roofline, cheap own gutters (budget <15k tris).
Facade types: 'step' (Flemish crow-stepped gable), 'cornice' (rendered neoclassical), 'brick' (segmental arches, iron
balcony), 'shop' (shop front with fascia sign). Variants a/b/c = three rows; '-ruin' = middle house collapsed.
usage: blender -b --python townhouse_row.py -- outdir variant seed"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eu_common import (K, V, args, SHUTTER, DOOR, pick, finish, iron_fence, roof_tone, ridge_tiles, roof_decals,
                       eave_streaks, scorch_openings, floor_slab, use_cheap_windows, use_cheap_doors)
import kit_core as C
use_cheap_windows()
use_cheap_doors()

OUT, VAR, SEED = args('townhouse_row_a')
base, RUIN = VAR.split('-')[0], VAR.endswith('ruin')
K.begin('townhouse_row_' + VAR.replace('-', '_'), SEED, theater='temperate')
r = K.rng()
rr = random.Random(SEED * 3 + ord(base))
ROWS = {'a': ['step', 'cornice', 'brick'], 'b': ['brick', 'shop', 'cornice'], 'c': ['cornice', 'step', 'shop']}
types = ROWS[base]
D = 9.0
y0, y1 = -D / 2, D / 2
T = 0.4
widths = [r.uniform(5.2, 6.2) for _ in types]
X0 = -sum(widths) / 2
DRESS = 'ashlar_limestone'
SLATE_T = [(0.9, 0.92, 0.96), (1.0, 1.0, 1.0), (0.84, 0.86, 0.9), (1.0, 0.96, 0.92)]
houses = []
xa = X0
for i, (typ, w) in enumerate(zip(types, widths)):
    xb = xa + w
    zf = [0, 3.7, 6.8, 9.7]
    ze = zf[-1] + (0.3 if typ == 'cornice' else 0.1) + r.uniform(-0.2, 0.5)
    brick = pick(r, ['brick_red', 'brick_dark', 'brick_red']) if typ != 'cornice' else 'plaster_white'
    rtint = pick(r, [(1.0, 0.96, 0.86), (0.92, 0.9, 0.84), (0.95, 0.88, 0.76)]) if brick == 'plaster_white' else None
    houses.append(dict(i=i, typ=typ, xa=xa, xb=xb, w=w, zf=zf, ze=ze, mid=brick, tint=rtint))
    xa = xb
MID = len(houses) // 2


def fband(xa, xb, z, h, proj, mid, name, y=y0, s=-1):
    """Projecting band (string course / sill band / cornice step) on the front (s=-1) or back (s=+1) face."""
    K.P(mid, K.box_bm, ((xa + xb) / 2, y + s * (proj / 2 - 0.02), z + h / 2), (xb - xa, proj + 0.04, h), name=name)


def coping_rake(p0, p1, t, mid=DRESS, name='coping'):
    """Stone coping slab along a rising wall top p0->p1 (overhangs both faces)."""
    K.P(mid, K.beam_bm, V(p0) + V((0, 0, 0.06)), V(p1) + V((0, 0, 0.06)), t + 0.12, 0.12, name=name)


def own_gutters(xa, xb, ze, eoh, pitch, side_pipes):
    """Cheap eave gutters front+back with one downpipe each (hopper + shoe) - replaces the 1.6k-tri kit gutters."""
    bm = K.bm_new()
    zg = ze - eoh * math.tan(math.radians(pitch)) + 0.05
    for s, xp in zip((-1, 1), side_pipes):
        yg = s * (D / 2 + eoh + 0.06)
        K.cyl_bm(bm, (xa, yg, zg), (xb, yg, zg), 0.07, 6)
        yw = s * (D / 2 + 0.07)
        K.box_bm(bm, (xp, yw, zg - 0.35), (0.2, 0.16, 0.22))
        for a, b in (((xp, yg, zg), (xp, yw, zg - 0.3)), ((xp, yw, zg - 0.4), (xp, yw, 0.25)), ((xp, yw, 0.25), (xp, yw + s * 0.25, 0.06))):
            K.cyl_bm(bm, a, b, 0.05, 6)
    K.part(bm, 'cast_iron', name='gutters', smooth=True, grime=0.5, mat_tint=(0.55, 0.57, 0.56))


for H in houses:
    i, typ, xa, xb, w, zf, ze, mid = H['i'], H['typ'], H['xa'], H['xb'], H['w'], H['zf'], H['ze'], H['mid']
    H['p_start'] = len(C.A.parts)
    poly = [(xa, y0), (xb, y0), (xb, y1), (xa, y1)]
    nb = 3 if (typ == 'cornice' and w > 5.9) else 2
    bx = [w * (k + 0.5) / nb for k in range(nb)]
    fr, wins, tall = [], [], []
    if typ == 'shop':
        shop = K.opening(poly, 0, w * 0.4, w * 0.55, 2.6, 0.55, T, 'rect', 'window')
        dr = K.opening(poly, 0, w * 0.84, 1.1, 2.7, 0.12, T, 'rect', 'door')
        fr += [shop, dr]
    else:
        dr = K.opening(poly, 0, bx[0], 1.15, 2.75, 0.18, T, 'segment' if typ != 'cornice' else 'rect', 'door')
        fr.append(dr)
        for k in range(1, nb):
            f = K.opening(poly, 0, bx[k], 1.15, 2.2, 0.95, T, 'segment' if typ == 'brick' else 'rect')
            fr.append(f); wins.append(f)
    for fl in (1, 2):
        for k in range(nb):
            hh = 2.15 if fl == 1 else 1.75
            sh = 'segment' if typ in ('brick', 'step') else 'rect'
            bal = typ == 'brick' and fl == 1 and k == nb // 2
            f = K.opening(poly, 0, bx[k], 1.1, hh + (0.6 if bal else 0), zf[fl] + (0.75 if not bal else 0.15), T, sh)
            fr.append(f); (tall if bal else wins).append(f)
    # rear elevation: two bays per upper floor, kitchen window + door on the ground floor
    back = [K.opening(poly, 2, w * t, 0.95, 1.5, zf[fl] + 0.85, T, 'segment' if mid != 'plaster_white' else 'rect')
            for fl, t in ((1, 0.3), (1, 0.7), (2, 0.5))] + [K.opening(poly, 2, w * 0.3, 1.1, 1.3, 1.0, T)]
    bdoor = K.opening(poly, 2, w * 0.72, 0.95, 2.15, 0.1, T, 'rect', 'door')
    K.wall_ring(poly, ze, T, mid, fr + back + [bdoor], name='walls%d' % i, mat_tint=H['tint'], plinth=('granite', 0.55, 0.04))
    # --- facade dressing (front + back)
    if typ in ('brick', 'step', 'shop'):
        for fl in (1, 2):
            fband(xa + 0.02, xb - 0.02, zf[fl] - 0.12, 0.18, 0.07, DRESS, 'band%d_%d' % (i, fl))
    else:
        fband(xa + 0.02, xb - 0.02, zf[1] - 0.2, 0.3, 0.09, DRESS, 'band%d_1' % i)
        for k, z in enumerate((0.5, 1.0, 1.5, 2.0, 2.5, 3.0)):          # rusticated ground floor (horizontal joints)
            fband(xa + 0.02, xb - 0.02, z + 0.44, 0.05, 0.02, DRESS, 'rust%d_%d' % (i, k))
    fband(xa + 0.02, xb - 0.02, zf[1] - 0.1, 0.14, 0.05, DRESS, 'bband%d' % i, y=y1, s=1)
    shut = pick(r, ['cream', 'grey', 'green', 'oxblood', 'blue'])
    fcol = pick(r, ['white', (0.82, 0.8, 0.72), (0.35, 0.33, 0.3), (0.45, 0.2, 0.16)])
    for k, f in enumerate(wins):
        K.window(f, 'casement', (2, 3) if f.h > 2.1 else (2, 2), frame=fcol, sill=DRESS, lintel=DRESS if typ != 'brick' else 'brick_dark',
                 surround=DRESS if typ == 'cornice' else None, shutters=None if (typ != 'cornice' or f.o.z < 3) else ('open' if k % 3 else 'closed'),
                 shutter_color=SHUTTER[shut], shutter_style='plank', curtain=0.75, name='w%d_%d' % (i, k), recess=0.22,
                 streak=typ == 'brick' and k % 2 == 0)
    for k, f in enumerate(tall):
        K.window(f, 'casement', (2, 4), frame=fcol, sill=None, lintel=DRESS, curtain=0.7, name='wt%d_%d' % (i, k), recess=0.22, streak=False)
        o, n = f.o, f.n                                      # cheap iron balcony: stone slab on consoles + light railing
        K.P(DRESS, K.box_bm, (o.x, o.y - 0.3, f.o.z - 0.08), (1.9, 0.62, 0.14), name='balc_slab%d' % i)
        for dx in (-0.7, 0.7):
            K.P(DRESS, K.box_bm, (o.x + dx, o.y - 0.18, f.o.z - 0.35), (0.14, 0.36, 0.4), name='balc_cons%d' % i, taper=(1, 1.4))
        zb_ = f.o.z - 0.01
        for p0, p1 in (((o.x - 0.9, o.y - 0.55), (o.x + 0.9, o.y - 0.55)), ((o.x - 0.9, o.y), (o.x - 0.9, o.y - 0.55)), ((o.x + 0.9, o.y - 0.55), (o.x + 0.9, o.y))):
            iron_fence(p0, p1, zb_, 0.95, 0.24, name='balc_rail%d' % i, tips=False)
    for k, f in enumerate(back):
        K.window(f, 'casement', (1, 1), frame=(0.7, 0.68, 0.64), sill=DRESS, lintel='brick_dark' if mid != 'plaster_white' else None,
                 name='wb%d_%d' % (i, k), streak=False, recess=0.18, curtain=0.0)
    K.door(dr, 'front%d' % i, 'panel' if typ == 'cornice' else ('glazed' if typ == 'shop' else 'plank'), DOOR[pick(r, ['green', 'brown', 'blue', 'oxblood', 'varnish', 'black'])],
           step='granite', surround=DRESS if typ == 'cornice' else None, lintel=DRESS)
    K.door(bdoor, 'back%d' % i, 'plank', DOOR['brown'], step='granite', lintel='brick_dark')
    if typ == 'shop':
        K.window(shop, 'fixed', (3, 2), frame=(0.25, 0.3, 0.28), sill='granite', lintel=None, curtain=0.0, streak=False, name='shopwin%d' % i, recess=0.1)
        fband(xa + 0.1, xb - 0.1, 3.3, 0.55, 0.14, 'wood_paint', 'fascia%d' % i)
        sg = K.sign(((xa + xb) / 2, y0 - 0.17, 3.57), (0, -1, 0), min(w - 0.8, 3.6), pick(r, ['boulangerie', 'epicerie', 'cafe_gare', 'estaminet']))
        for px in (xa + 0.12, xb - 0.12):
            K.P('wood_paint', K.box_bm, (px, y0 - 0.07, 1.9), (0.24, 0.16, 3.8), name='pil%d' % i, mat_tint=(0.3, 0.36, 0.33))
    if i % 2 == 0:                                        # single-storey rear kitchen extension (achterbouw) with lean-to
        ex0, ex1 = xb - w * 0.5, xb - 0.1                   # over the kitchen window, clear of the back door
        ep = [(ex0, y1 - 0.05), (ex1, y1 - 0.05), (ex1, y1 + 2.6), (ex0, y1 + 2.6)]
        ew = K.opening(ep, 2, (ex1 - ex0) / 2, 0.8, 1.0, 1.0, 0.3)
        K.wall_ring(ep, 2.7, 0.3, 'brick_red' if mid == 'plaster_white' else mid, [ew], name='ext%d' % i)
        K.window(ew, 'casement', (1, 2), frame=(0.7, 0.68, 0.64), sill=DRESS, lintel='brick_dark', name='wx%d' % i, streak=False)
        K.roof_shed(ex0, y1, ex1, y1 + 2.6, 2.8, 3.5, 'corrugated_galv' if i % 2 else 'roof_tile_flat', low_side='+y', oh=0.15,
                    name='ext_roof%d' % i, gutters=False)
    H['n_roof0'] = len(C.A.parts)
    # --- roofs -----------------------------------------------------------------------------------------------------
    H['stint'] = SLATE_T[(i + SEED) % len(SLATE_T)]
    if typ == 'step':             # Flemish crow-stepped gable to the street, ridge along y
        pitch = 52
        rise = (w / 2) * math.tan(math.radians(pitch))
        ns = 5
        cx = (xa + xb) / 2
        tread = (w / 2) / (ns + 1)
        for s_ in range(ns + 1):
            hw = w / 2 - s_ * tread
            z0s = ze + s_ * rise / (ns + 1)
            z1s = ze + (s_ + 1) * rise / (ns + 1) + 0.35
            K.P(mid, K.box_bm, (cx, y0 + T / 2 + 0.05, (z0s + z1s) / 2), (hw * 2, T + 0.1, z1s - z0s), name='step%d_%d' % (i, s_))
            for sx in (-1, 1):                               # projecting stone coping on every step (+ drip overhang)
                if hw > 0.3:
                    K.P(DRESS, K.box_bm, (cx + sx * (hw - tread / 2 + 0.02), y0 + T / 2 + 0.05, z1s + 0.07), (tread + 0.14, T + 0.28, 0.14),
                        name='cope%d_%d' % (i, s_))
        K.P(DRESS, K.box_bm, (cx, y0 + T / 2 + 0.05, ze + rise + 0.35 + (rise / (ns + 1)) + 0.1), (0.55, T + 0.28, 0.2), name='apex%d' % i)
        K.P(DRESS, K.box_bm, (cx, y0 + T / 2 + 0.05, ze + rise + 0.55 + rise / (ns + 1)), (0.22, 0.22, 0.5), name='finial%d' % i, taper=(0.4, 0.4))
        for sx in (-1, 1):                                   # kneelers at the foot of the gable
            K.P(DRESS, K.box_bm, (cx + sx * (w / 2 - 0.25), y0 + T / 2 + 0.05, ze - 0.05), (0.6, T + 0.3, 0.3), name='kneeler%d' % i)
        R = K.roof_gable(cx, 0.15, D - 0.3, w - 0.1, ze, pitch, 'roof_slate', rot=math.pi / 2, eave_oh=0.02, gable_oh=0.25,
                         fascia=None, barge=None, gutters=False, sag=0.03, name='roof%d' % i, ridge=None)
        H['R'] = R
        # attic hatch: real recess in the gable, plank doors, limestone surround, hoist beam with pulley
        import eu_dmg
        zh = ze + 0.45
        eu_dmg.carve([eu_dmg.Box((cx, y0 + 0.09, zh + 0.65), (1, 0, 0), (0, 1, 0), (0, 0, 1), (0.42, 0.11, 0.65))],
                     only=lambda o: o.name.startswith('step%d' % i))
        K.P('door_planks', K.box_bm, (cx, y0 + 0.17, zh + 0.65), (0.84, 0.04, 1.3), name='hatch%d' % i, mat_tint=(0.55, 0.5, 0.42))
        for sx in (-1, 1):
            K.P(DRESS, K.box_bm, (cx + sx * 0.52, y0 - 0.01, zh + 0.65), (0.2, 0.08, 1.5), name='hatch_jamb%d' % i)
        K.P(DRESS, K.box_bm, (cx, y0 - 0.01, zh + 1.42), (1.24, 0.1, 0.2), name='hatch_lintel%d' % i)
        K.P(DRESS, K.box_bm, (cx, y0 - 0.04, zh - 0.05), (1.1, 0.14, 0.1), name='hatch_sill%d' % i)
        K.P('timber_beam', K.beam_bm, (cx, y0 + 0.3, zh + 1.85), (cx, y0 - 0.85, zh + 1.85), 0.16, 0.2, name='hoist%d' % i, uv='beam', axis=(0, 1, 0))
        K.P('cast_iron', K.cyl_bm, (cx - 0.04, y0 - 0.72, zh + 1.62), (cx + 0.04, y0 - 0.72, zh + 1.62), 0.13, 8, name='pulley%d' % i)
        K.gable(poly, 2, ze, R.z_ridge - R.lift, T, mid, name='backgable%d' % i)
        zr_top = R.z_ridge
        ridge_tiles(R.w(-(D - 0.3) / 2 - 0.1, 0, R.z_ridge + 0.03), R.w((D - 0.3) / 2 + 0.2, 0, R.z_ridge + 0.03), mid='roof_slate',
                    tint=(0.8, 0.82, 0.86), r=0.12, finials=False, name='ridge%d' % i, seg=0.6)
    else:
        pitch = 50 if typ != 'cornice' else 56
        if typ == 'cornice':
            K.P(DRESS, K.box_bm, ((xa + xb) / 2, y0 - 0.12, ze - 0.35), (w, 0.3, 0.2), name='cornA%d' % i)
            K.P(DRESS, K.box_bm, ((xa + xb) / 2, y0 - 0.2, ze - 0.12), (w, 0.45, 0.25), name='cornB%d' % i)
        else:
            bm = K.bm_new()
            for k in range(int(w / 0.45)):                  # brick dentil course under the eaves (one part)
                K.box_bm(bm, (xa + 0.22 + k * 0.45, y0 - 0.06, ze - 0.25), (0.22, 0.12, 0.12))
            K.part(bm, 'brick_dark', name='dent%d' % i)
        rmat = 'roof_tile_flat' if (typ == 'shop' and base == 'b') else 'roof_slate'
        R = K.roof_gable((xa + xb) / 2, 0, w, D, ze, pitch, rmat, eave_oh=0.3, gable_oh=0.0, thick=0.12, fascia=None, barge=None,
                         gutters=False, sag=0.03, wobble=0.01, name='roof%d' % i, ridge=None)
        H['R'] = R
        if rmat == 'roof_slate':
            for o in R.parts:
                if 'slope' in o.name:
                    o.data.materials[0] = K.mat('roof_slate', H['stint'])
        own_gutters(xa + 0.05, xb - 0.05, ze, 0.3, pitch, (xb - 0.3, xa + 0.3))
        nd = (2 if w > 5.9 else 1) if typ == 'cornice' else 1
        for lx in ([-w / 4, w / 4] if nd == 2 else [w * 0.12 if typ != 'shop' else -w * 0.15]):
            K.dormer(R, lx, -1, 1.0 if typ == 'cornice' else 1.2, 1.3, wall='plaster_white' if typ == 'cornice' else mid,
                     roof='roof_slate' if rmat == 'roof_slate' else rmat,
                     window_kw=dict(style='casement', panes=(2, 2), frame='white', sill=None, streak=False, curtain=0.5))
        if i == MID:
            K.dormer(R, 0.0, 1, 0.9, 1.1, wall=mid, roof=rmat, window_kw=dict(style='casement', panes=(1, 2), frame='white', sill=None, streak=False, curtain=0.3))
        zr_top = R.z_ridge
        ridge_tiles(R.w(-w / 2 + 0.25, 0, R.z_ridge + 0.03), R.w(w / 2 - 0.25, 0, R.z_ridge + 0.03),
                    mid='roof_tile_flat' if rmat != 'roof_slate' or typ == 'brick' else 'roof_slate',
                    tint=(0.85, 0.75, 0.68) if (rmat != 'roof_slate' or typ == 'brick') else (0.78, 0.8, 0.84), r=0.12, finials=False, name='ridge%d' % i, seg=0.6)
    roof_tone(R, amp=0.18, seed=SEED + i * 7)
    roof_decals(R, 2, seed=SEED + i)
    H['zr'] = zr_top
    H['roofparts'] = C.A.parts[H['n_roof0']:]
    K.chimney(xa + (0.0 if i else 0.35), 1.0 if typ != 'step' else 2.8, ze - 1.0, zr_top + 0.7, 0.9 if i else 0.7, 0.55, 'brick_red',
              cap='ashlar', pots=pick(r, [1, 2]), name='chim%d' % i)
    H['p_end'] = len(C.A.parts)
    H['names'] = set(o.name for o in C.A.parts[H['p_start']:H['p_end']])     # (indices shift once parts are removed)
    K.decal('damp_base', ((xa + xb) / 2, y0 - 0.06, 0.5), (0, -1, 0), w * 0.8, 0.9, alpha=0.55)
    if r.random() < 0.5 and typ != 'shop':
        K.decal('poster_fr', (xa + 0.6, y0 - 0.07, 1.7), (0, -1, 0), 0.6, 0.8)

# ---- party walls: every eaves-front house closes both roof ends with a parapeted gable + stone coping (firewall),
#      lead flashing where a lower roof abuts it ------------------------------------------------------------------
for k, H in enumerate(houses):
    if H['typ'] == 'step':
        continue
    poly = [(H['xa'], y0), (H['xb'], y0), (H['xb'], y1), (H['xa'], y1)]
    zr = H['zr'] - 0.12
    for e, x in ((3, H['xa']), (1, H['xb'])):
        nb_ = houses[k - 1] if (e == 3 and k > 0) else (houses[k + 1] if (e == 1 and k < len(houses) - 1) else None)
        if nb_ is not None and nb_['typ'] != 'step' and nb_['zr'] > H['zr'] + 0.05:
            continue                                        # the taller neighbour's firewall covers this junction
        mat_ = H['mid'] if H['mid'] != 'plaster_white' else 'brick_red'
        K.gable(poly, e, H['ze'], zr + 0.35, T, mat_, name='firewall%d_%d' % (k, e))
        xm = x + (T / 2 if e == 3 else -T / 2)
        ye = D / 2 + 0.15
        for s in (-1, 1):
            coping_rake((xm, s * ye, H['ze'] - 0.15 * 0 + 0.25), (xm, 0, zr + 0.35), T, name='fw_coping%d' % k)
        if nb_ is not None and nb_['typ'] != 'step' and nb_['zr'] < H['zr'] - 0.05:
            R2 = nb_['R']                                   # lead flashing on the lower neighbour's roof against the wall
            tp = math.tan(math.radians(R2.pitch))
            xl = x + (-0.15 if e == 3 else 0.15)
            for s in (-1, 1):
                a = V((xl, s * (D / 2), nb_['ze'] + R2.lift + 0.02))
                b = V((xl, 0, nb_['ze'] + (D / 2) * tp + R2.lift + 0.02))
                K.P('steel_galv', K.beam_bm, a, b, 0.3, 0.02, name='flashing%d' % k, mat_tint=(0.5, 0.52, 0.55))

# ---- exposed west party wall of the row: chimney breast, tie-irons, ghost roofline of a demolished neighbour ------------
H = houses[0]
xw = H['xa'] - 0.002
bm = K.bm_new()
K.box_bm(bm, (H['xa'] - 0.16, 1.0, (H['zr'] + 0.7) / 2), (0.32, 1.3, H['zr'] + 0.7))
K.part(bm, H['mid'] if H['mid'] != 'plaster_white' else 'brick_red', name='chimney_breast')
bm = K.bm_new()
for z in (3.6, 6.7):
    for y in (-3.2, -0.8, 3.0):
        c_ = V((xw - 0.02, y, z))
        K.beam_bm(bm, c_ + V((0, -0.28, -0.28)), c_ + V((0, 0.28, 0.28)), 0.05, 0.03, up=V((1, 0, 0)))
        K.beam_bm(bm, c_ + V((0, -0.28, 0.28)), c_ + V((0, 0.28, -0.28)), 0.05, 0.03, up=V((1, 0, 0)))
K.part(bm, 'cast_iron', name='tie_irons', grime=0.2, lod='drop')
bm = K.bm_new()
gz_e, gz_r = 6.6, 9.4                                       # ghost of the neighbour's pitched roof + floor lines
for (ya, za), (yb, zb) in (((-D / 2, gz_e), (0, gz_r)), ((0, gz_r), (D / 2, gz_e)), ((-D / 2, 3.55), (D / 2, 3.55))):
    K.beam_bm(bm, V((xw - 0.012, ya, za)), V((xw - 0.012, yb, zb)), 0.02, 0.28, up=V((1, 0, 0)))
K.part(bm, 'plaster_rough', name='ghost_roofline', mat_tint=(0.62, 0.58, 0.52), grime=0.3, bisect=False)
bm = K.bm_new()
for (ya, yb, za, zb), tint in (((-4.2, -1.0, 0.7, 3.4), 0), ((0.6, 4.1, 0.7, 3.4), 1), ((-4.2, 3.9, 3.9, 6.3), 2)):
    q = [V((xw - 0.008, ya, za)), V((xw - 0.008, ya, zb)), V((xw - 0.008, yb, zb)), V((xw - 0.008, yb, za))]
    bm.faces.new([bm.verts.new(p) for p in q])
K.part(bm, 'plaster_rough', name='ghost_rooms', mat_tint=(0.78, 0.72, 0.6), grime=0.6, bisect=False)
K.anchor('roof_ridge', (0, 0, max(h['zr'] for h in houses)))
for x in (X0 - 0.4, -X0 + 0.4):
    K.wall_lantern((x + (0.4 if x < 0 else -0.4), y0, 0), (0, -1, 0), 3.2)
eave_streaks([((houses[0]['xa'], y1), (houses[-1]['xb'], y1))], min(h['ze'] for h in houses) - 0.3, n=4, seed=SEED, alpha=0.3)

# ---- ruin: the middle house collapsed (roof + front gone to the first floor, floors fallen, wallpaper exposed) -------------
if RUIN:
    import eu_dmg
    m = houses[MID]
    xa, xb, zf, ze, w = m['xa'], m['xb'], m['zf'], m['ze'], m['w']
    cx = (xa + xb) / 2
    inner = [(xa + T, y0 + T), (xb - T, y0 + T), (xb - T, y1 - T), (xa + T, y1 - T)]
    eu_dmg.remove_parts(lambda o: o in m['roofparts'])
    eu_dmg.strip_shutters(0.7, SEED)
    floor_slab(inner, zf[1] + 0.1, name='mfloor1', joists=True)
    floor_slab([(xa + T, y1 - T - 1.3), (xb - T, y1 - T - 1.3), (xb - T, y1 - T), (xa + T, y1 - T)], zf[2] + 0.1, name='mfloor2',
               joists=False)                                  # only a strip of the second floor still hangs on the back wall
    floor_slab(inner, 0.1, name='mfloor0', joists=False, mid='cobblestone')
    import bpy
    mine = set(m['names'])
    mine |= set(o.name for o in C.A.parts if o.name.startswith(('firewall%d' % MID, 'fw_coping%d' % MID, 'mfloor')))
    own = lambda o: o.name in mine or o.name.startswith('mfloor')
    bx, _ = eu_dmg.ragged_boxes((xa + T + 0.3, y0), (xb - T - 0.3, y0), zf[2] + 0.9, zf[1] + 0.4, thick=2.2, seed=SEED)
    bb, _ = eu_dmg.ragged_boxes((xb - T - 0.3, y1), (xa + T + 0.3, y1), ze - 0.6, zf[2] + 0.3, thick=1.2, seed=SEED + 1)
    bs = []
    for xw_, sgn in ((xa + T / 2, 1), (xb - T / 2, -1)):   # its own side walls: broken, stepped tops (party walls stand)
        b_, _ = eu_dmg.ragged_boxes((xw_, y0 - 0.2), (xw_, y1 + 0.2), ze + 0.6, ze - 2.4, thick=T + 0.4, seed=SEED + 3 + sgn, keep_ends=0.0)
        bs += b_
    eu_dmg.carve(bx + bb + bs, only=own)
    fb, _ = eu_dmg.blast_boxes((cx - 0.8, y1 - 1.8, zf[2] + 0.1), 1.0, 0.0, (1.3, 1.0, 0.5), 0.25, 0.5, SEED + 5)
    fb2, _ = eu_dmg.blast_boxes((cx + 0.3, y0 + 3.0, zf[1] + 0.1), 2.6, 0.0, (1.1, 1.4, 0.5), 0.25, 0.4, SEED + 6)
    eu_dmg.carve(fb + fb2, only=lambda o: o.name.startswith('mfloor'))
    rq = random.Random(SEED + 9)
    bm, bj = K.bm_new(), K.bm_new()

    def sag_section(x_w, sgn, z, ya, yb, Ls, a0, a1, drop_p=0.18):
        """A floor section still hinged in the party-wall pocket at x_w and sagging (bending ever steeper) towards the
        void: 3 joists along the sag curve with snapped, splintered ends, loose boards across them (random lengths,
        gaps where boards dropped out, the last boards hanging at odd angles)."""
        pts, p, n_ = [], V((x_w, 0, z - 0.14)), 10
        for i in range(n_ + 1):
            s = i / n_
            pts.append(p.copy())
            a = math.radians(a0 + (a1 - a0) * s ** 1.6)
            p = p + V((sgn * math.cos(a), 0, -math.sin(a))) * (Ls / n_)
        for k, yj in enumerate([ya + 0.15 + (yb - ya - 0.3) * t for t in (0.0, 0.5, 1.0)]):
            m_ = int(n_ * rq.uniform(0.65, 1.0))                     # each joist snapped at its own length
            for i in range(m_):
                a_, b_ = pts[i] + V((0, yj, 0)), pts[i + 1] + V((0, yj, 0))
                if i == m_ - 1:
                    eu_dmg.splinter_bm(bj, a_, b_ + (b_ - a_) * 0.4, 0.08, 0.2, rq, 0.25)
                else:
                    K.beam_bm(bj, a_, b_ + (b_ - a_).normalized() * 0.02, 0.08, 0.2)
        sb = 0.0
        while sb < Ls * 0.95:
            i = min(n_ - 1, int(sb / Ls * n_))
            c = pts[i].lerp(pts[i + 1], (sb / Ls * n_) - i)
            t_ = (pts[i + 1] - pts[i]).normalized()
            up = t_.cross(V((0, 1, 0))).normalized()
            up = up if up.z > 0 else -up
            c = c + up * 0.12
            late = sb / Ls
            if rq.random() > drop_p + 0.45 * late ** 2:
                y_a = ya + rq.uniform(0, 0.25) + (rq.uniform(0, 0.9) if late > 0.6 else 0)
                y_b = yb - rq.uniform(0, 0.25) - (rq.uniform(0, 0.9) if late > 0.6 else 0)
                tw = rq.uniform(-0.15, 0.15) * late                  # loose boards twist
                K.beam_bm(bm, c + V((0, y_a - c.y, 0)), c + V((0, y_b - c.y, tw)), 0.17, 0.035, up=up, roll=rq.uniform(-0.1, 0.1) * late)
            sb += 0.19
        return pts

    xw_l, xw_r = xa + T, xb - T
    span = xw_r - xw_l
    for fl, yc_, ww_ in ((1, y0 + 2.4, 2.6), (2, y1 - T - 2.6, 2.2)):
        z = zf[fl] + 0.1
        ya, yb = yc_ - ww_ / 2, yc_ + ww_ / 2
        sag_section(xw_l, 1, z, ya, yb, span * rq.uniform(0.42, 0.5), rq.uniform(8, 14), rq.uniform(38, 52))
        if fl == 1:                                   # the facing half hangs steeper, shorter, from the other wall
            sag_section(xw_r, -1, z, ya + 0.3, yb - 0.1, span * 0.36, rq.uniform(20, 28), rq.uniform(60, 72), 0.3)
        for xw_, sgn in ((xw_l, 1), (xw_r, -1)):            # joist ends left in the party-wall pockets, some hanging
            for k in range(4):
                yj = y0 + T + 0.45 + k * 1.1
                if ya - 0.2 < yj < yb + 0.2:
                    continue
                L_ = rq.uniform(0.2, 0.9)
                dz_ = rq.uniform(0, 0.2) if rq.random() < 0.6 else rq.uniform(0.4, 1.1)
                eu_dmg.splinter_bm(bj, V((xw_ - sgn * 0.05, yj, z - 0.15)), V((xw_ + sgn * L_, yj, z - 0.15 - dz_)), 0.08, 0.2, rq, 0.14)
    # fragment of the upper floor lying broken on the ground-floor heap: two pieces, boards splayed
    for k, (px, py, rz, ln) in enumerate(((cx - 0.7, 0.9, 0.35, 1.6), (cx + 0.9, -0.2, -0.5, 1.1))):
        base_z = 0.55 + 0.25 * k
        for j in range(7 if k == 0 else 5):
            if rq.random() < 0.2:
                continue
            a = rz + rq.uniform(-0.12, 0.12)
            d = V((math.cos(a), math.sin(a), 0))
            o_ = V((px, py, base_z)) + V((-d.y, d.x, 0)) * (j * 0.19) + V((0, 0, rq.uniform(-0.08, 0.1)))
            K.beam_bm(bm, o_, o_ + d * ln * rq.uniform(0.6, 1.0) + V((0, 0, rq.uniform(-0.35, 0.1))), 0.17, 0.035)
    K.part(bm, 'deck_planks', name='fallen_floor', uv='beam', axis=(0, 1, 0), grime=0.6, tint=(0.62, 0.55, 0.48))
    K.part(bj, 'timber_tarred', name='joist_ends', uv='beam', axis=(1, 0, 0), grime=0.4)
    # a gutted house has no dark interior cards: open windows show the rubble / sky, not black boxes
    eu_dmg.remove_parts(lambda o: o.data.materials and o.data.materials[0] and
                        o.data.materials[0].get('kit_id') in ('interior_dark', 'curtain') and
                        xa - 0.05 < sum((o.matrix_world @ V(b)).x for b in o.bound_box) / 8 < xb + 0.05)
    # exposed wallpaper / distemper per room on the inner faces of both party walls + fireplace flue ghosts
    papers = [(0.62, 0.7, 0.58), (0.78, 0.62, 0.6), (0.8, 0.74, 0.52), (0.6, 0.66, 0.74)]
    for xw_, sgn in ((xa + T + 0.006, 1), (xb - T - 0.006, -1)):
        for fl in (0, 1, 2):
            bm = K.bm_new()
            za, zb = zf[fl] + 0.2, (zf[fl + 1] if fl < 2 else ze) - 0.15
            for ya, yb in ((y0 + T + 0.1, 0.3), (0.5, y1 - T - 0.1)):
                q = [V((xw_, ya, za)), V((xw_, yb, za)), V((xw_, yb, zb)), V((xw_, ya, zb))]
                if sgn < 0:
                    q.reverse()
                bm.faces.new([bm.verts.new(p) for p in q])
            K.part(bm, 'plaster_rough', name='wallpaper%d' % fl, mat_tint=papers[(fl + (sgn > 0)) % 4], grime=0.7, bisect=False)
            K.decal('soot', (xw_, 1.0, zf[fl] + 1.4), (sgn, 0, 0), 0.9, 2.2, alpha=0.7)
    eu_dmg.heap((cx, y0 - 1.0, 0), 3.0, 1.7, stone='brick_red', dress=DRESS, brick='brick_red', tiles='roof_slate', seed=SEED,
                name='heap_street', beams=3, planks=3, elong=1.3, n=16)
    eu_dmg.heap((cx + 0.2, 0.2, 0.1), 2.5, 2.6, stone='brick_red', dress=None, brick='brick_red', tiles='roof_slate', seed=SEED + 3,
                name='heap_in', beams=2, planks=2, footprint=False, n=6)
    for k, sgn in ((MID + 1, -1),):                              # neighbour roof holed next to the collapse
        Hn = houses[k]
        if Hn['typ'] != 'step':
            eu_dmg.roof_breach(Hn['R'], [(sgn * (Hn['w'] / 2 - 1.2), -1.8, 1.2)], seed=SEED + k)
    scorch_openings(0.7)
finish(OUT)
