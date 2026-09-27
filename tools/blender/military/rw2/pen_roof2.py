# ------------------------------------------------------------------ rework 2: roof life (tar patches, puddles, moss, debris,
# cable runs, MG nests, camouflage nets on the ribs) - breaks the stripe field seen at the game camera
from mathutils import noise as NZ
def rib_top(y):
    return any(abs(y - ry) < 0.7 for ry in RIBY)
bm = bmesh.new()                                          # bitumen repair patches on rib tops + trough floors
for i in range(26):
    ry = r.choice(RIBY)
    top = r.random() < 0.6
    cx, cy = r.uniform(X0 + 2, X1 - 2), (ry if top else ry + 1.65)
    w, h = r.uniform(1.2, 4.0), (r.uniform(0.6, 1.25) if top else r.uniform(0.8, 1.7))
    z = (ZR + 1.3 + 0.012) if top else (ZR + 0.012)
    pts = [(cx + math.cos(a) * w / 2 * r.uniform(0.75, 1.0), cy + math.sin(a) * h / 2 * r.uniform(0.75, 1.0)) for a in [2 * math.pi * k / 7 for k in range(7)]]
    if any(math.hypot(px - fx, py - fy) < 4.6 for px, py in pts for fx, fy in FLAK):
        continue
    f = bm.faces.new([bm.verts.new((px, py, z)) for px, py in K.ccw(pts)])
K.part(bm, 'bitumen_felt', name='tar_patches', mat_tint=(0.55, 0.55, 0.55), grime=0.2, bisect=False, lod='drop')
if VAR != 'snow':
    for i in range(18):                                   # standing water + moss / weeds colonising the troughs
        ry = r.choice(RIBY[:-1]) + 1.65
        K.decal(r.choice(['stain_blotch', 'moss_patch', 'moss_patch', 'damp_base']), (r.uniform(X0 + 2, X1 - 2), ry, ZR + 0.02 + i * 0.0005), (0, 0, 1),
                r.uniform(2.0, 5.5), r.uniform(1.2, 1.8), up=(0, 1, 0), alpha=r.uniform(0.55, 0.85))
    for i in range(10):                                   # lichen / dirt tide on rib tops, varied per rib
        ry = r.choice(RIBY)
        K.decal(r.choice(['lichen', 'stain_blotch', 'dirt_splash']), (r.uniform(X0 + 2, X1 - 2), ry, ZR + 1.3 + 0.02 + i * 0.0005), (0, 0, 1),
                r.uniform(2.0, 6.0), 1.3, up=(0, 1, 0), alpha=0.6)
for cx, cy in ((4.0, -24.0), (-8.0, 26.0), (15.0, -14.0)):  # spalled concrete debris lying in the troughs
    cy = min(RIBY, key=lambda ry: abs(ry - cy)) + 1.65
    M.rubble((cx, cy, ZR), 0.9, 0.35, mids=('concrete_bunker',), n=6, beams=0, tiles=None, footprint=False, mound_tint=(0.75, 0.75, 0.74))
bm = bmesh.new()                                          # cable runs (field telephone / power) looping over the ribs
for x0c, y0c, y1c in ((X0 + 2.2, -38.0, 34.0), (X1 - 2.6, -34.0, 12.0), (-1.5, -8.0, 22.0)):
    pts = []
    yy = y0c
    while yy < y1c:
        z = ZR + 1.3 + 0.04 if rib_top(yy) else ZR + 0.05
        pts.append(V((x0c + 0.15 * math.sin(yy * 0.7), yy, z)))
        yy += 0.35
    for a_, b_ in zip(pts[:-1], pts[1:]):
        K.cyl_bm(bm, a_, b_, 0.025, 4, caps=False)
K.part(bm, 'cast_iron', name='cables', mat_tint=(0.35, 0.35, 0.33), grime=0, bisect=False, lod='drop')
bm = bmesh.new()                                          # 2 MG nests (sandbag rings) at the seaward roof corners
for cx, cy in ((X0 + 3.0, Y0 + 3.0), (X1 - 3.2, Y0 + 5.3)):
    cy = min(RIBY, key=lambda ry: abs(ry - cy))
    M.sandbag_ring(bm, (cx, cy, 0), 1.2, courses=3, gap_ang=math.radians(90), gap_w=0.8, z0=ZR + 1.3, r=r)
M.sandbags_part(bm, 'roof_mg_bags', tint=(0.85, 0.85, 0.82) if VAR == 'snow' else None)
for k, (cx, cy) in enumerate(((X0 + 3.0, Y0 + 3.0), (X1 - 3.2, Y0 + 5.3))):
    cy = min(RIBY, key=lambda ry: abs(ry - cy))
    M.mg34((cx, cy, ZR + 1.3), yaw=math.pi + (0.4 if k else -0.4), name='roof_mg')
bm = bmesh.new()                                          # ammunition boxes / ready racks by the Flak stands
for fx, fy in FLAK:
    for k in range(4):
        a = r.uniform(0, 2 * math.pi)
        K.box_bm(bm, (fx + math.cos(a) * 3.1, fy + math.sin(a) * 3.1 * 0.2 + (4.3 if k % 2 else -4.3), ZR + 1.3 + 0.15), (0.7, 0.35, 0.3), r.uniform(0, 3))
K.part(bm, 'wood_paint', name='ammo_boxes', mat_tint=(0.5, 0.55, 0.4), grime=0.6, bisect=False, lod='drop')
if VAR != 'snow':                                         # camouflage nets stretched over the ribs by two ringstands
    for (fx, fy), (w, h) in ((FLAK[2], (9.0, 8.0)), (FLAK[1], (10.0, 7.0))):
        sup = lambda x, y: ZR + 1.3 if rib_top(y) else ZR + 0.95
        M.camo_net(fx - w / 2 - 4.0, fy - h / 2, fx - 4.0 + w / 2, fy + h / 2, sup, cell=0.45, drop=lambda x, y: ZR + 1.32,
                   tint=(0.5, 0.52, 0.42), sag=0.15, garnish=0.3)
