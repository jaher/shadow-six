# ic_store.py part 2 (exec'd in its namespace): door cheeks, boards, bombs on skids, crates, sand, footprint
if not DEST:
    for s in (-1, 1):                      # sandbag blast cheeks either side of the W door, standing off the wall
        dz.sandbags((-HW - 0.45, s * 1.45), (-HW - 2.1, s * 1.45), rows=6, name='cheek%d' % (s + 1), thick=2, footprint=False)
    sign_board((-HW - 0.33, 2.6, 2.1), (-1, 0, 0), 0.9, 0.5, name='warn_n', post=False)
    sign_board((-HW - 0.33, -2.6, 2.1), (-1, 0, 0), 0.9, 0.5, name='warn_s', post=False)
    # SC 250 bombs on timber skids along the S wall (nose E), two crate stacks of fuzes
    bm = bmesh.new()
    for k in range(4):
        y = -HD - 1.15 - (0.45 if k % 2 else 0.0)
        x0 = -2.6 + (k // 2) * 2.4
        z = 0.38 + 0.4 * (k % 2) * 0
        C.cyl_bm(bm, V((x0, y, 0.38)), V((x0 + 1.15, y, 0.38)), 0.18, 12)
        C.cyl_bm(bm, V((x0 + 1.15, y, 0.38)), V((x0 + 1.5, y, 0.38)), 0.18, 12, r1=0.05)
        C.cyl_bm(bm, V((x0 - 0.45, y, 0.38)), V((x0, y, 0.38)), 0.09, 8, r1=0.17)
        for a in (0, math.pi / 2):
            C.box_bm(bm, (x0 - 0.4, y, 0.38), (0.4, 0.42 * abs(math.cos(a)) + 0.02, 0.42 * abs(math.sin(a)) + 0.02))
    K.part(bm, 'paint_metal', name='bombs', mat_tint=(0.62, 0.6, 0.5), grime=0.6, bisect=False, smooth=True)
    beams([((-3.2, -HD - 0.85, 0.1), (2.4, -HD - 0.85, 0.1)), ((-3.2, -HD - 1.75, 0.1), (2.4, -HD - 1.75, 0.1))], s=0.18, name='skids', tint=(0.7, 0.6, 0.48))
    bm = bmesh.new()
    for k, (x, y, z) in enumerate(((3.4, -HD - 1.0, 0), (3.4, -HD - 1.65, 0), (3.4, -HD - 1.32, 0.42), (4.2, -HD - 1.1, 0))):
        dz.crate(bm, (x, y, z), (0.7, 0.55, 0.42), r.uniform(-0.06, 0.06))
    K.part(bm, 'wood_paint', name='fuze_boxes', mat_tint=DAK, grime=0.8, bisect=False)
    jerrycans((HW + 0.3, -2.0, 0), n=4, rot=math.pi / 2)
    drums([(HW + 0.55, 2.4, 0), (HW + 0.55, 3.1, 0)], tint=(0.4, 0.43, 0.36), name='water_drums')
else:
    bm = bmesh.new()                       # bombs blown about: two casings split open, a fin
    C.cyl_bm(bm, V((-1.2, -HD - 1.4, 0.2)), V((-0.2, -HD - 1.9, 0.35)), 0.18, 10)
    C.cyl_bm(bm, V((2.0, -HD - 2.6, 0.18)), V((2.7, -HD - 2.2, 0.2)), 0.17, 10, r1=0.1)
    K.part(bm, 'paint_metal', name='casings', mat_tint=(0.3, 0.28, 0.24), grime=1.0, bisect=False, smooth=True)
    for k in range(4):
        K.decal('scorch_a', (r.uniform(-HW - 3, HW + 3), r.uniform(-HD - 3, HD + 3), 0.014), (0, 0, 1), r.uniform(2.5, 4.5), r.uniform(2.0, 4.0), alpha=0.7)
sand_feet(poly, h=0.24, w=0.85, seed=SEED, skip=(3,))
C.roof_meta(poly, ZT, walkable=False)
K.footprint(rect(-HW, -HD, HW, HD), 'HIGH', 'building')
dz.finalize(os.path.join(OUT, NAME), ao_res=1024, ao_samples=40)
