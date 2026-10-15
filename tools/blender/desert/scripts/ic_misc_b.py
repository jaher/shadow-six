# ic_misc.py part 2 (exec'd in its namespace): revet, hut, finalize
if VAR == 'revet':
    HL, HT, H = 1.0, 0.25, 2.4             # panel 2.0 long (x), 0.5 thick, 2.4 high; buttress on the back (+y)
    bm = bmesh.new()
    C.box_bm(bm, (0, -0.1, H / 2), (2 * HL - 0.02, 2 * HT, H), taper=(1.0, 0.86))
    K.part(bm, 'concrete_bunker', name='panel', mat_tint=(0.92, 0.88, 0.8), grime=1.1, uv='aligned')
    bm = bmesh.new()
    C.hexa_bm(bm, [V((-0.2, 0.15, 0.0)), V((0.2, 0.15, 0.0)), V((0.2, 0.5, 0.0)), V((-0.2, 0.5, 0.0)),
                   V((-0.2, 0.15, H - 0.3)), V((0.2, 0.15, H - 0.3)), V((0.2, 0.2, H - 0.3)), V((-0.2, 0.2, H - 0.3))])
    C.box_bm(bm, (0, 0.05, 0.12), (2 * HL - 0.1, 0.95, 0.24))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'concrete_bunker', name='buttress', mat_tint=(0.86, 0.82, 0.74), grime=1.2)
    bm = bmesh.new()                       # a rounded cap course + two lifting lugs (precast)
    C.box_bm(bm, (0, -0.1, H + 0.04), (2 * HL - 0.04, 2 * HT * 0.86 + 0.06, 0.08))
    K.part(bm, 'concrete_bunker', name='cap', mat_tint=(0.86, 0.82, 0.74), grime=1.0, bisect=False)
    K.decal('damp_base', (0, -0.37, 0.3), (0, -1, 0), 1.9, 0.5, alpha=0.22)
    dz.sand_drift((-HL, -0.4), (HL, -0.4), (0, -1, 0), h=0.25, w=0.7, seed=SEED, name='sand_f')
    dz.sand_drift((-HL, 0.55), (HL, 0.55), (0, 1, 0), h=0.3, w=0.8, seed=SEED + 1, name='sand_b')
    K.footprint(rect(-HL, -0.5, HL, 0.5), 'HIGH', 'wall')

if VAR == 'hut':
    HW = 1.05
    P = rect(-HW, -HW, HW, HW)
    dz.sandbags((-HW - 0.2, -HW - 0.25), (HW + 0.2, -HW - 0.25), rows=5, name='bags_s', thick=2, footprint=False)
    dz.sandbags((HW + 0.25, -HW), (HW + 0.25, HW), rows=5, name='bags_e', thick=2, footprint=False)
    dz.sandbags((-HW - 0.25, -HW), (-HW - 0.25, HW), rows=5, name='bags_w', thick=2, footprint=False)
    door = K.opening(P, 2, HW, 0.8, 1.95, 0.0, 0.08, 'rect', 'door')
    slit = K.opening(P, 0, HW, 1.4, 0.35, 1.25, 0.08, 'rect')
    K.wall_ring(P, 2.15, 0.08, 'boards_weathered', [door, slit], name='walls', mat_tint=(0.82, 0.74, 0.6))
    K.door(door, 'main', 'plank', (0.6, 0.55, 0.44), step=None, hinge='left', open_deg=40)
    KR.roof_shed(-HW - 0.25, -HW - 0.25, HW + 0.25, HW + 0.25, 2.15, 2.4, mid='corrugated_rust', thick=0.04, oh=0.05, low_side='+y', name='roof')
    bm = bmesh.new()
    for k, (x, y) in enumerate(((-0.8, -0.6), (0.6, 0.4), (0.0, -1.0))):
        C.box_bm(bm, (x, y, 2.5 - 0.04 * y), (0.55, 0.3, 0.15), rot_z=r.uniform(-0.4, 0.4))
    K.part(bm, 'hessian', name='roof_bags', mat_tint=(0.86, 0.76, 0.6), grime=0.8, bisect=False, smooth=True)
    bm = bmesh.new()
    C.box_bm(bm, (HW + 0.1, HW - 0.6, 1.3), (0.15, 0.3, 0.35))
    K.part(bm, 'wood_paint', name='phone_box', mat_tint=(0.5, 0.48, 0.36), grime=0.6, bisect=False)
    wire((HW + 0.18, HW - 0.6, 1.4), (HW + 0.6, HW + 3.0, 4.8), sag=0.4, name='phone_wire', r=0.008)
    K.footprint(rect(-HW - 0.45, -HW - 0.45, HW + 0.45, HW + 0.45), 'HIGH', 'building')

dz.finalize(os.path.join(OUT, NAME), ao_res=512 if VAR != 'pump' else 1024, ao_samples=32)
