# townhouse_fr.py variant 'flat' (exec'd in its namespace): the corner block's E part, 12 x 19.8, flat walkable roof R
HX, HY = 6.0, 9.9
ZR = 12.5                                          # walkable roof (mission LEVEL.R), parapet 0.8
G = rect(-HX, -HY, HX, HY)
# ---- ground floor: brasserie under the balcony (S), a shop on the tram street (N), hotel entrance on the garden street (E)
shops = [K.opening(G, 0, 3.6, 5.6, 3.95, 0.0, T, 'rect', 'window'),        # S: brasserie front (under the balcony)
         K.opening(G, 2, 3.4, 4.6, 3.95, 0.0, T, 'rect', 'window'),        # N: quincaillerie
         K.opening(G, 1, 4.0, 4.6, 3.95, 0.0, T, 'rect', 'window')]        # E: boucherie
hotel = K.opening(G, 1, 12.6, 1.8, 3.2, 0.0, T, 'segment', 'door')
gw = [K.opening(G, 2, 9.5, 1.2, 2.1, 1.0, T, 'segment', 'window'),
      K.opening(G, 1, 16.6, 1.2, 2.1, 1.0, T, 'segment', 'window')]
fs = upper_windows(G, 0, (1.5, 4.5), Z1, ZR, french_first=True, balconette=[(0, 8.6)], shutters=0.25)
fn = upper_windows(G, 2, (1.5, 4.5, 7.5, 10.5), Z1, ZR, balconette=[(2, 8.6)], shutters=0.35)
fe = upper_windows(G, 1, (1.8, 5.1, 8.4, 11.7, 15.0, 18.0), Z1, ZR, balconette=[(1, 8.6)], shutters=0.35)
K.wall_ring(G, ZR, T, STONE, shops + [hotel] + gw + fs + fn + fe, plinth=('granite', 0.4, 0.04), name='walls', mat_tint=CREAM)
for F, (txt, col, awn, dx, did, goods) in zip(shops, [('BRASSERIE', (0.30, 0.12, 0.10), (0.62, 0.12, 0.10), 1.8, 'brasserie', (0.6, 0.45, 0.3)),
                                                      ('QUINCAILLERIE', (0.24, 0.26, 0.22), (0.30, 0.36, 0.28), -1.5, 'shop_n', (0.45, 0.42, 0.38)),
                                                      ('BOUCHERIE', (0.40, 0.14, 0.12), (0.62, 0.14, 0.12), 1.5, 'shop_e', (0.7, 0.35, 0.3))]):
    shopfront(F, col, sign=txt, awning=awn, door_x=dx, did=did, goods=goods, awn_depth=0.0 if did == 'brasserie' else 1.4, name='shop_' + did)
K.door(hotel, 'hotel', 'double', DOOR['varnish'], step='granite', lintel=None, surround=TRIM, fanlight=True)
text3d('HOTEL DU NORD', hotel.p(0, 3.65, 0.06), hotel.n, size=0.3, depth=0.03, name='hotel_sign')
for k, f in enumerate(gw):
    K.window(f, 'casement', (2, 3), frame='white', recess=0.14, sill=TRIM, surround=TRIM, bars=True, curtain=0.5, name='wg%d' % k)
dress_windows(fs, 'ws')
dress_windows(fn, 'wn')
dress_windows(fe, 'we')
# rustication grooves on the ground floor
bm = bmesh.new()
for z in [0.9 + 0.5 * k for k in range(7)]:
    for (a, b, n) in (((-HX, -HY), (HX, -HY), (0, -1)), ((HX, -HY), (HX, HY), (1, 0)), ((HX, HY), (-HX, HY), (0, 1))):
        nn = V((n[0], n[1], 0))
        K.beam_bm(bm, V((a[0], a[1], z)) + nn * 0.01, V((b[0], b[1], z)) + nn * 0.01, 0.03, 0.02)
K.part(bm, 'interior_dark', name='rustication', grime=0.0, bisect=False, mat_tint=(0.5, 0.48, 0.44))
K.course(G, Z1 - 0.3, 0.3, 0.1, TRIM, name='band_ground')
facade_trim(G, Z2 - 0.1, ZR + 0.3)
K.quoins(G, Z1, ZR - 0.3, TRIM, corners=(1, 2), block_h=0.42, long=0.62, short=0.36)
# ---- flat roof R: tar screed, stone parapet 0.8 m with coping (crouch cover), lead spouts; nothing stands on it
K.roof_flat(G, ZR, 'tar_paper', parapet_h=0.8, parapet_t=0.32, parapet_mid=STONE, coping=TRIM, walkable=True, name='roof_r')
# ---- iron balcony B (y 4.5) in front of the S face, x -6 .. 1.2 (W end continues the W part's terrace)
bx0, bx1, by = -HX, 1.25, -HY - 2.2
bm = bmesh.new()
K.box_bm(bm, ((bx0 + bx1) / 2, (-HY + by) / 2, Z1 - 0.07), (bx1 - bx0, 2.2, 0.14))
K.part(bm, 'steel_grating', name='balcony_deck', mat_tint=(0.45, 0.45, 0.45))
bm = bmesh.new()
for x in [bx0 + 0.4 + k * (bx1 - bx0 - 0.8) / 4 for k in range(5)]:      # cast-iron consoles
    pts = [V((x, -HY, Z1 - 0.14)), V((x, by + 0.15, Z1 - 0.14)), V((x, -HY, Z1 - 1.3))]
    C.loft_bm(bm, [[p - V((0.04, 0, 0)) for p in pts], [p + V((0.04, 0, 0)) for p in pts]])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
K.part(bm, 'cast_iron', name='balcony_consoles')
bm = bmesh.new()
C.cyl_bm(bm, V((bx0, by + 0.03, Z1 - 0.1)), V((bx1, by + 0.03, Z1 - 0.1)), 0.04, 6)
K.part(bm, 'cast_iron', name='balcony_edge')
K.railing((bx0, by + 0.05, Z1), (bx1, by + 0.05, Z1), 1.0, 'iron', spacing=0.2, name='balcony_rail_s')
K.railing((bx1, by + 0.05, Z1), (bx1, -HY, Z1), 1.0, 'iron', spacing=0.2, name='balcony_rail_e')
# laundry line + clothes rack on the balcony (the uniform's rack is the mission's own interactable)
weather(-HX, HX, -HY, ZR)
K.decal('poster_fr', (HX + 0.03, 8.5, 1.9), (1, 0, 0), 0.8, 1.1, alpha=0.9)
K.wall_lantern((HX, 10.6, 0), (1, 0, 0), 3.4)
K.anchor('roof_r', (0, 0, ZR))
