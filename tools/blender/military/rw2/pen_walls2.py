# ------------------------------------------------------------------ rework 2: long-wall rhythm: pilasters every bay, vent hoods,
# personnel doors behind blast baffles, melt / rain streaking; pen interiors read as concrete (not black voids)
bm = bmesh.new()
for x, yv, sx in HOODS:
    K.box_bm(bm, (x, yv, 8.75), (0.6, 3.1, 0.22))
for sx, x in ((-1, X0), (1, X1)):
    for k in range(10):
        yv = Y0 + 1.25 + k * 9.5
        if sx > 0 and SY0 - 2.5 < yv < SY1 + 2.5:
            continue
        K.hexa_bm(bm, [V((x, yv - 0.8, ZB)), V((x, yv + 0.8, ZB)), V((x + sx * 0.7, yv + 0.8, ZB)), V((x + sx * 0.7, yv - 0.8, ZB)),
                       V((x, yv - 0.8, ZW - 0.6)), V((x, yv + 0.8, ZW - 0.6)), V((x + sx * 0.12, yv + 0.8, ZW - 0.1)), V((x + sx * 0.12, yv - 0.8, ZW - 0.1))])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
M.conc_part(bm, 'pilasters', 'concrete_board', CT)
bm, bd, bk = bmesh.new(), bmesh.new(), bmesh.new()
for sx, x in ((-1, X0), (1, X1)):
    for yv in ((-20.0, 14.0) if sx < 0 else (-26.0, 2.0)):
        K.box_bm(bd, (x + sx * 0.01, yv, 1.05), (0.03, 1.3, 2.1))                   # steel door leaf (dark grey)
        K.box_bm(bk, (x + sx * 0.03, yv, 2.2), (0.08, 1.6, 0.14))                   # angle-iron frame head
        for dy in (-0.72, 0.72):
            K.box_bm(bk, (x + sx * 0.03, yv + dy, 1.1), (0.08, 0.14, 2.2))
        M.wall_strip(bm, [(x + sx * 1.6, yv - 2.6), (x + sx * 1.6, yv + 1.2), (x + sx * 0.2, yv + 1.2)], lambda s_: 2.4, 0.6, sx)
        K.footprint([(x, yv + 1.2), (x + sx * 2.2, yv + 1.2), (x + sx * 2.2, yv - 2.6), (x + sx * 1.6, yv - 2.6)], 'HIGH', 'blast_baffle')
M.conc_part(bm, 'door_baffles', 'concrete_board', CT)
K.part(bd, 'steel_painted', name='side_doors', mat_tint=(0.42, 0.44, 0.42), grime=0.8, bisect=False)
K.part(bk, 'cast_iron', name='side_door_frames', grime=0.5, bisect=False)
for i in range(16):                                        # extra rust / rain runs from the roof lip, varied widths
    yv = r.uniform(Y0 + 1, Y1 - 1)
    for sx, x in ((-1, X0 - 0.405), (1, X1 + 0.405)):
        if sx > 0 and SY0 - 1 < yv < SY1 + 1:
            continue
        K.decal(r.choice(['streak_rust', 'streak_long', 'efflorescence']), (x, yv, ZR - 2.0), (sx, 0, 0), r.uniform(1.0, 2.6), 3.2, alpha=0.7)
bm = bmesh.new()                                           # pen soffit + back wall + inner quay walls: dim concrete, not void
for (a, b) in PENS:
    K.box_bm(bm, ((a + b) / 2, (Y0 + YW) / 2, ZO - 0.12), (b - a - 0.02, YW - Y0, 0.06))
K.part(bm, 'concrete_slab', name='pen_soffit', mat_tint=(0.42, 0.42, 0.41), grime=0.3, bisect=False)
bm = bmesh.new()
for (a, b) in PENS:
    for k in range(5):                                     # soffit lamps (dim, gives scale and depth)
        K.box_bm(bm, ((a + b) / 2, Y0 + 6 + k * 14, ZO - 0.25), (0.5, 0.5, 0.2))
K.part(bm, 'steel_painted', name='pen_lamps', mat_tint=(0.9, 0.85, 0.6), grime=0, bisect=False, lod='drop')
if VAR == 'snow':                                          # drifts: every trough its own fill (none / partial / full, wind-scalloped)
    bm = bmesh.new()
    for ry in RIBY[:-1]:
        kind = r.random()
        if kind < 0.25:
            continue
        h0 = r.uniform(0.25, 0.55) if kind < 0.7 else r.uniform(0.7, 1.15)
        sd = r.uniform(0, 50)
        xs_ = [X0 + 0.6 + (X1 - X0 - 1.2) * i / 24 for i in range(25)]
        rows = []
        for x in xs_:
            hz = max(0.02, h0 * (0.55 + 0.6 * NZ.noise(V((x * 0.12 + sd, ry * 0.1, 1.3)))))
            if any(math.hypot(x - fx, ry + 1.65 - fy) < 4.4 for fx, fy in FLAK):
                hz = 0.02
            yl, yr = ry + 0.72, ry + 3.3 - 0.72
            rows.append([bm.verts.new((x, yl - 0.02, ZR + hz * 0.95)), bm.verts.new((x, (yl + yr) / 2 + 0.25 * NZ.noise(V((x * 0.3, sd, 2.0))), ZR + hz)),
                         bm.verts.new((x, yr + 0.02, ZR + hz * 0.8))])
        for a_, b_ in zip(rows[:-1], rows[1:]):
            for k in range(2):
                bm.faces.new((a_[k], b_[k], b_[k + 1], a_[k + 1]))
    for f in bm.faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    K.part(bm, 'snow', name='trough_drifts', grime=0, smooth=True, bisect=False)
    bm = bmesh.new()                                       # icicles under the roof lip, apron lip and vent hoods
    for sx, x in ((-1, X0 - 0.4), (1, X1 + 0.4)):
        yv = Y0
        while yv < Y1:
            yv += r.uniform(0.6, 2.8)
            if sx > 0 and SY0 - 1 < yv < SY1 + 1:
                continue
            L = r.uniform(0.25, 1.1)
            K.cyl_bm(bm, (x - sx * 0.05, yv, ZW - 0.02), (x - sx * 0.05, yv, ZW - 0.02 - L), 0.06 + L * 0.04, 4, r1=0.005)
    for i in range(40):
        xv = r.uniform(X0 + 1.2, PENS[1][1] + 1.3)
        L = r.uniform(0.3, 1.4)
        K.cyl_bm(bm, (xv, Y0 - 6.95, ZW + 0.58), (xv, Y0 - 6.95, ZW + 0.58 - L), 0.07 + L * 0.03, 4, r1=0.005)
    K.part(bm, 'snow', name='icicles', mat_tint=(0.9, 0.95, 1.0), grime=0, smooth=True, bisect=False, lod='drop')
    for i in range(20):                                    # melt-water staining under the icicle lines
        yv = r.uniform(Y0 + 1, Y1 - 1)
        for sx, x in ((-1, X0 - 0.406), (1, X1 + 0.406)):
            if sx > 0 and SY0 - 1 < yv < SY1 + 1:
                continue
            K.decal(r.choice(['streak_long', 'damp_base', 'streak_rain']), (x, yv, ZW - 2.4), (sx, 0, 0), r.uniform(1.2, 3.0), 4.0, alpha=0.75)
