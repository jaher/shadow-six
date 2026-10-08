# townhouse_fr.py variant 'w' (exec'd in its namespace): the corner block's W part, 14 x 22 x 16
HX, HY, YU = 7.0, 11.0, -8.8                      # half length, half depth, upper-floor front line (terrace behind it)
ZE, ZC, ZT = 12.2, 15.2, 16.0                     # main eave, mansard curb, top
G = rect(-HX, -HY, HX, HY)
U = rect(-HX, YU, HX, HY)
# ---- ground floor: channelled limestone, shop fronts (S, W, N), porte-cochere on the W avenue
shops = [K.opening(G, 0, 4.0, 4.4, 3.95, 0.0, T, 'rect', 'window'),        # S: Cafe de la Paix (door D1 at x -3)
         K.opening(G, 0, 10.2, 4.6, 3.95, 0.0, T, 'rect', 'window'),       # S: tabac
         K.opening(G, 3, 4.2, 4.6, 3.95, 0.0, T, 'rect', 'window'),        # W: patisserie
         K.opening(G, 3, 17.0, 4.6, 3.95, 0.0, T, 'rect', 'window'),       # W: pharmacie
         K.opening(G, 2, 3.6, 4.6, 3.95, 0.0, T, 'rect', 'window'),        # N: mercerie (tram street)
         K.opening(G, 2, 10.2, 4.6, 3.95, 0.0, T, 'rect', 'window')]       # N: librairie
coch = K.opening(G, 3, 10.6, 2.6, 3.6, 0.0, T, 'segment', 'door')
K.wall_ring(G, Z1, T, STONE, shops + [coch], plinth=('granite', 0.4, 0.04), name='walls_ground', mat_tint=CREAM)
bm = bmesh.new()                                   # channelled rustication: horizontal grooves (dark strips) every 0.5 m
for z in [0.9 + 0.5 * k for k in range(7)]:
    for (a, b, n) in (((-HX, -HY), (HX, -HY), (0, -1)), ((-HX, HY), (-HX, -HY), (-1, 0)), ((HX, HY), (-HX, HY), (0, 1))):
        a3, b3 = V((a[0], a[1], z)), V((b[0], b[1], z))
        nn = V((n[0], n[1], 0))
        K.beam_bm(bm, a3 + nn * 0.01, b3 + nn * 0.01, 0.03, 0.02)
K.part(bm, 'interior_dark', name='rustication', grime=0.0, bisect=False, mat_tint=(0.5, 0.48, 0.44))
SIGNS = [('CAFE DE LA PAIX', (0.30, 0.12, 0.10), (0.62, 0.12, 0.10), 0.0, 'D1', (0.6, 0.45, 0.3)),
         ('TABACS', (0.18, 0.24, 0.30), (0.20, 0.30, 0.45), 1.5, 'shop2', (0.55, 0.5, 0.4)),
         ('PATISSERIE', (0.82, 0.78, 0.66), (0.62, 0.14, 0.12), 1.5, 'shop3', (0.75, 0.6, 0.45)),
         ('PHARMACIE', (0.20, 0.32, 0.24), (0.25, 0.42, 0.30), -1.5, 'shop4', (0.8, 0.82, 0.78)),
         ('MERCERIE', (0.36, 0.20, 0.28), (0.55, 0.15, 0.18), 1.5, 'shop5', (0.5, 0.4, 0.55)),
         ('LIBRAIRIE', (0.22, 0.20, 0.16), (0.30, 0.38, 0.30), -1.5, 'shop6', (0.7, 0.62, 0.5))]
for F, (txt, col, awn, dx, did, goods) in zip(shops, SIGNS):
    shopfront(F, col, sign=txt, awning=awn, door_x=dx, did=did, goods=goods, awn_depth=1.4, name='shop_' + did)
K.door(coch, 'porte_cochere', 'double', DOOR['green'], step=None, lintel=None, surround=TRIM)
# ---- terrace (walkway B, y 4.5) on the ground floor's S strip: lead-flashed flags, stone edge, iron railing
bm = bmesh.new()
K.box_bm(bm, (0, (-HY + YU) / 2, Z1 - 0.12), (2 * HX, YU + HY, 0.24))
K.part(bm, 'patio_flags', name='terrace', mat_tint=(0.82, 0.82, 0.8))
K.course(rect(-HX, -HY, HX, YU + 0.01), Z1 - 0.32, 0.3, 0.1, TRIM, name='terrace_edge')
K.railing((-HX + 0.05, -HY + 0.12, Z1), (HX, -HY + 0.12, Z1), 1.0, 'iron', spacing=0.2, name='terrace_rail_s')
K.railing((-HX + 0.12, YU, Z1), (-HX + 0.12, -HY + 0.12, Z1), 1.0, 'iron', spacing=0.2, name='terrace_rail_w')
# ---- upper floors (S front set back to YU): French windows onto the terrace, balconettes on the 2nd floor
fs = upper_windows(U, 0, (1.75, 5.25, 8.75, 12.25), Z1, ZE, french_first=True, balconette=[(0, 8.6)], shutters=0.3)
fw = upper_windows(U, 3, (1.65, 4.95, 8.25, 11.55, 14.85, 18.15), Z1, ZE, balconette=[(3, 8.6)], shutters=0.35)
fn = upper_windows(U, 2, (1.75, 5.25, 8.75, 12.25), Z1, ZE, balconette=[(2, 8.6)], shutters=0.35)
K.wall_ring(U, ZE - Z1, T, STONE, fs + fw + fn, z0=Z1, name='walls_upper', footprint=False, mat_tint=CREAM)
dress_windows(fs, 'ws')
dress_windows(fw, 'ww')
dress_windows(fn, 'wn')
K.balcony((-HX, 2.0, 0), (-1, 0, 0), 9.0, 0.7, Z1 + 0.05, slab=TRIM, rail='iron', brackets=4, name='bal_w')   # W avenue balcony
facade_trim(U, Z2 - 0.1, ZE)
K.course(G, Z1 - 0.3, 0.3, 0.1, TRIM, name='band_ground')
K.quoins(U, Z1, ZE - 0.5, TRIM, corners=(0, 3), block_h=0.42, long=0.62, short=0.36)
# ---- mansard + lucarnes + chimney stacks on the E fire wall
mansard(-HX, YU, HX, HY, ZE, ZC, ZT, oh=0.3, inset=1.05, inset_top=2.7, vertical=('E',))
for x in (-5.25, -1.75, 1.75, 5.25):
    lucarne((x, YU - 0.02, ZE + 0.02), (0, -1, 0), name='luc_s%d' % int(x * 10), pediment='segment' if abs(x) > 2 else 'tri')
    lucarne((x, HY + 0.02, ZE + 0.02), (0, 1, 0), name='luc_n%d' % int(x * 10))
for y in (-5.5, -1.0, 3.5, 8.0):
    lucarne((-HX - 0.02, y, ZE + 0.02), (-1, 0, 0), name='luc_w%d' % int(y * 10), pediment='segment' if y < 2 else 'tri')
for y, zt in ((-6.5, ZT + 2.0), (0.5, ZT + 2.3), (7.5, ZT + 1.9)):
    K.chimney(HX - 0.4, y, ZE, zt, 1.4, 0.7, 'brick_red', cap='ashlar', pots=4)
K.chimney(-3.0, HY - 0.6, ZE, ZT + 1.4, 0.9, 0.6, 'brick_red', cap='ashlar', pots=2)
weather(-HX, HX, -HY, Z1)
weather(-HX, HX, YU, ZE)
K.decal('poster_fr', (-HX - 0.03, -6.5, 2.0), (-1, 0, 0), 0.8, 1.1, alpha=0.9)
K.decal('poster_fr', (-HX - 0.03, 7.6, 1.9), (-1, 0, 0), 0.8, 1.1, alpha=0.85)
K.wall_lantern((-HX, -HY, 0), (0, -1, 0), 3.9)
K.anchor('roof_ridge', (0, 1.0, ZT))
