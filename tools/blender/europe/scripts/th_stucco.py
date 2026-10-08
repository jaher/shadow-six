# townhouse_fr.py variant 'stucco' (exec'd in its namespace): cream-rendered townhouse 14 x 14 x 13 with a wine shop
HX, HY = 7.0, 7.0
ZA, ZB, ZE, ZC, ZT = 4.0, 7.2, 10.5, 12.4, 13.0
WALL, WT = 'plaster_white', (0.98, 0.92, 0.78)
G = rect(-HX, -HY, HX, HY)
shop = K.opening(G, 0, 6.0, 6.0, 3.6, 0.0, T, 'rect', 'window')            # S: centre x -1, door D2 at x -3
entry = K.opening(G, 0, 11.6, 1.3, 2.7, 0.0, T, 'segment', 'door')          # house entrance
gw = [K.opening(G, 3, 3.5, 1.1, 2.0, 1.0, T, 'segment', 'window'), K.opening(G, 3, 10.5, 1.1, 2.0, 1.0, T, 'segment', 'window'),
      K.opening(G, 2, 3.5, 1.0, 1.8, 1.1, T, 'segment', 'window'), K.opening(G, 2, 10.5, 1.0, 1.8, 1.1, T, 'segment', 'window')]
up = []
for e, ts in ((0, (1.75, 5.25, 8.75, 12.25)), (3, (1.75, 5.25, 8.75, 12.25)), (2, (2.5, 7.0, 11.5))):
    for t in ts:
        for zs, h in ((ZA + 0.75, 2.05), (ZB + 0.75, 1.95)):
            f = K.opening(G, e, t, 1.1, h, zs, T, 'segment', 'window')
            f._bal = e == 0 and zs < ZB
            f._shut = r.random() < (0.8 if e != 0 else 0.6)
            up.append(f)
K.wall_ring(G, ZE, T, WALL, [shop, entry] + gw + up, plinth=('granite', 0.45, 0.04), name='walls', mat_tint=WT)
K.quoins(G, 0.45, ZE - 0.4, TRIM, corners=(0, 3), block_h=0.4, long=0.6, short=0.34)
K.course(G, ZA - 0.2, 0.22, 0.07, TRIM, name='band_a')
K.course(G, ZB - 0.1, 0.18, 0.05, TRIM, name='band_b')
K.cornice(G, ZE - 0.45, TRIM, steps=((0.06, 0.12), (0.14, 0.12), (0.24, 0.16)), name='cornice')
for k, f in enumerate(up):
    K.window(f, 'casement', (2, 3), frame='white', recess=0.12, sill=TRIM, surround=TRIM if f.n.y < -0.5 else None,
             shutters='open' if f._shut else None, shutter_color=SHUTTER['green'],
             shutter_style='plank', curtain=0.7, name='wu%d' % k)
    if f._bal:
        K.railing(f.p(-0.7, 0.02, 0.22), f.p(0.7, 0.02, 0.22), 0.95, 'iron', name='bal%d' % k)
for k, f in enumerate(gw):
    K.window(f, 'casement', (2, 3), frame='white', recess=0.12, sill=TRIM, bars=True, curtain=0.4, name='wg%d' % k)
shopfront(shop, (0.36, 0.10, 0.12), sign='VINS A LA CONSOMMATION', awning=(0.58, 0.12, 0.12), door_x=-2.0, did='D2',
          goods=(0.35, 0.18, 0.2), awn_depth=1.3, name='shop')
K.door(entry, 'house', 'panel', DOOR['green'], step='granite', lintel=None, surround=TRIM, fanlight=True)
mansard(-HX, -HY, HX, HY, ZE, ZC, ZT, oh=0.28, inset=0.95, inset_top=2.4, vertical=('E',))
for x in (-5.25, -1.75, 1.75, 5.25):
    lucarne((x, -HY - 0.02, ZE + 0.02), (0, -1, 0), w=1.0, h=1.45, name='luc_s%d' % int(x * 10))
for y in (-3.5, 3.5):
    lucarne((-HX - 0.02, y, ZE + 0.02), (-1, 0, 0), w=1.0, h=1.45, name='luc_w%d' % int(y * 10), pediment='tri')
for y in (-4.0, 4.0):
    K.chimney(HX - 0.4, y, ZE, ZT + 1.6, 1.2, 0.65, 'brick_red', cap='ashlar', pots=3)
K.decal('poster_fr', (HX + 0.03, 0.0, 7.0), (1, 0, 0), 6.0, 3.6, alpha=0.55)       # faded painted advert on the E party wall
K.decal('poster_fr', (-HX - 0.03, 0.5, 1.9), (-1, 0, 0), 0.8, 1.1, alpha=0.9)
weather(-HX, HX, -HY, ZE)
K.wall_lantern((-HX, -HY, 0), (0, -1, 0), 3.4)
K.anchor('roof_ridge', (0, 0, ZT))
