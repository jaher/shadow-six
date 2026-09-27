def snow_blanket(R, q, th=0.2, lip=0.2, seed=0, icicles=True, base_off=0.0, name='snowbl', patchy=0.0, res=1.0):
    """Snow blanket over one roof slope quad q = (eave_a, eave_b, top_b, top_a): noisy drift thickness, thin at the
    ridge so the ridge cap line shows, a rounded cornice curling over the eave, melt holes around chimneys,
    closed verge skirts; optional icicles hanging from the cornice."""
    n = slope_normal(q)
    e = q[1] - q[0]
    upv = ((q[3] + q[2]) / 2 - (q[0] + q[1]) / 2)
    down = -upv.normalized()
    nu = max(2, int(e.length / (0.6 * res)))
    nv = max(3, int(upv.length / (0.5 * res)))
    rr = K.rng()
    ph = seed * 2.1 + rr.random() * 10

    def P(u, v):
        return q[0].lerp(q[1], u).lerp(q[3].lerp(q[2], u), v) + n * base_off

    def thick(p, v):
        k = th * (0.72 + 0.56 * noise01(p, 0.6, ph)) * (1 + 0.35 * (1 - v) ** 4)
        if patchy > 0:                                   # snow slid off in slabs: bare streaks near the eave
            lu = (p - q[0]).dot(e.normalized())
            bare = noise01((lu * 0.9, v * upv.length * 0.22, 0), 1.0, ph) - (1 - patchy * (1.2 - v))
            if bare > 0:
                return max(-0.08, k - bare * 10.0 * th)
        if v > 0.78:
            k *= max(0.12, 1 - (v - 0.78) / 0.22 * 0.9)
        return k

    melt = []
    for (x, y, w, d, zt) in CHIMNEYS:
        melt.append((x, y, max(w, d) / 2 + 0.3))
    bm = bmesh.new()
    rows, flags = [], []
    for j in range(-3, nv + 1):
        row, fl = [], []
        for i in range(nu + 1):
            u = i / nu
            if j >= 0:
                v = j / nv
                b = P(u, v)
                t = thick(b, v)
                edge = i in (0, nu)
                p = b + n * (t * (0.55 if edge else 1.0))
            else:
                b = P(u, 0)
                t = thick(b, 0)
                p = {-1: b + down * lip * 0.55 + n * t * 0.9,
                     -2: b + down * lip + n * t * 0.3 - Z * t * 0.45,
                     -3: b + down * lip * 0.7 - Z * t * 0.95 - n * 0.02}[j]
            m = any((p.x - mx) ** 2 + (p.y - my) ** 2 < mr * mr for mx, my, mr in melt)
            if j < 0 and t < 0.04:
                m = True
            row.append(bm.verts.new(p))
            fl.append(m)
        rows.append(row)
        flags.append(fl)
    for j in range(len(rows) - 1):
        for i in range(nu):
            if flags[j][i] or flags[j][i + 1] or flags[j + 1][i] or flags[j + 1][i + 1]:
                continue
            bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
    for i in (0, nu):                                   # verge skirts
        for j in range(3, len(rows) - 1):
            a, b = rows[j][i], rows[j + 1][i]
            c, d = bm.verts.new(b.co - n * 0.12), bm.verts.new(a.co - n * 0.12)
            bm.faces.new((a, b, c, d) if i == 0 else (b, a, d, c))
    orient(bm, bm.faces[:], n)
    ob = K.part(bm, 'snow', name=name, grime=0, bisect=False, jitter=0.02, smooth=True)

    def col(p, nn, c):
        k = 0.93 + 0.07 * noise01(p, 2.0, ph)
        if nn.z < 0.3:
            k *= 0.82
        for mx, my, mr in melt:
            d = math.hypot(p.x - mx, p.y - my)
            if d < mr + 0.5:
                k *= 0.8 + 0.2 * (d - mr) / 0.5
        return (c[0] * k * 0.97, c[1] * k * 0.98, c[2] * k)
    recolor(ob, col)
    if icicles:
        bm = bmesh.new()
        u = rr.uniform(0.02, 0.1)
        while u < 0.97:
            if rr.random() < 0.5:
                b = P(u, 0)
                t = thick(b, 0)
                top = b + down * lip * 0.75 - Z * t * 0.9
                L = 0.05 + rr.random() ** 2.2 * 0.6
                K.cyl_bm(bm, top + Z * 0.03, top - Z * L, 0.025 + L * 0.03, 4, r1=0.003, caps=False)
            u += rr.uniform(0.1, 0.35) / max(1.0, e.length)
        if bm.verts:
            ic = K.part(bm, 'snow', name='icicles', grime=0, bisect=False, mat_tint=(0.8, 0.88, 0.97), jitter=0.0,
                        smooth=True)
            ic['kit_lod'] = 'drop'
        else:
            bm.free()
    return ob


