"""Cable-car moving parts for M5.
  cabin = 8-person aerial cabin (1930s type), rework 2: rounded-corner pressed-steel body with belt bulge (red),
          continuous wrap-round window band leaning in (tumblehome) with cream frames/mullions, cream upper band,
          crowned silver roof with drip rail, hatch + ventilator, skirt, sliding door with its own track and grab
          rails, number plates, end lamps, gooseneck hanger to a 4-sheave carriage on the track rope. Pivot = ground centre
          under the cabin floor (kit contract, reviewable); the rope contact point is the 'rope_point' anchor (z ~ 3.6 m):
          the game hangs the 'cabin' node from the rope by subtracting that anchor offset.
  pylon = 14 m riveted lattice tower (tapering, K-bracing) with a crossarm carrying the two track-rope saddles and
          haul-rope sheaves, maintenance ladder and platform; concrete footings.
Usage: blender -b --python cable_car.py -- outdir cabin|pylon seed [snow]"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nlib as N
from nlib import K, V, C
import bmesh

OUT, VAR, SEED, SNOW = N.args('cable_car')
name = 'cable_car_' + VAR + ('_snow' if SNOW else '')
K.begin(name, SEED, theater='snow' if SNOW else 'temperate', snow=SNOW)
r = K.rng()
if VAR == 'cabin':
    ND = 'cabin'
    CW, CL, CH = 1.7, 2.3, 2.0              # across (X), along the line (Y), body height
    zb = 0.22                                # cabin floor above the pivot (skirt below it)
    RED, GREY = (0.7, 0.14, 0.1), (0.72, 0.73, 0.72)
    poly = N.rect(-CW / 2, -CL / 2, CW / 2, CL / 2)
    CREAM = (0.86, 0.82, 0.7)

    def rrect(w, l, rad, z, n=8, dx=0.0):
        pts = []
        for (cx, cy, a0) in ((w / 2 - rad, l / 2 - rad, 0), (-w / 2 + rad, l / 2 - rad, 90), (-w / 2 + rad, -l / 2 + rad, 180), (w / 2 - rad, -l / 2 + rad, 270)):
            for i in range(n + 1):
                a = math.radians(a0 + 90 * i / n)
                pts.append(V((cx + rad * math.cos(a) + dx, cy + rad * math.sin(a), z)))
        return pts
    RAD = 0.34                                 # generous rounded corners: a 1930s cabin, not a container
    zbelt, zw0, zw1, zt = zb + 0.92, zb + 1.0, zb + 1.86, zb + CH
    # lower body: slight bulge at the belt, painted red, smooth pressed panels (no ribs)
    bm = K.bm_new()
    C.loft_bm(bm, [rrect(CW - 0.06, CL - 0.06, RAD - 0.03, zb), rrect(CW + 0.02, CL + 0.02, RAD, zb + 0.45),
                   rrect(CW + 0.04, CL + 0.04, RAD, zbelt), rrect(CW, CL, RAD - 0.02, zw0)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'paint_metal', name='body_lower', mat_tint=RED, node=ND, smooth=True, grime=0.5)
    # window band leaning in (tumblehome) + upper band + crowned roof
    bm = K.bm_new()
    C.loft_bm(bm, [rrect(CW - 0.04, CL - 0.04, RAD - 0.04, zw0), rrect(CW - 0.2, CL - 0.2, RAD - 0.1, zw1)],
              close_start=False, close_end=False)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'glass_dirty', name='glazing', node=ND, smooth=True, grime=0.1)
    bm = K.bm_new()
    C.loft_bm(bm, [rrect(CW - 0.18, CL - 0.18, RAD - 0.08, zw1), rrect(CW - 0.18, CL - 0.18, RAD - 0.08, zt - 0.08),
                   rrect(CW + 0.02, CL + 0.02, RAD, zt), rrect(CW + 0.04, CL + 0.04, RAD + 0.01, zt + 0.07),
                   rrect(CW - 0.25, CL - 0.25, RAD, zt + 0.24), rrect(CW - 0.8, CL - 0.8, 0.2, zt + 0.33)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = K.part(bm, 'paint_metal', name='roof', mat_tint=CREAM, node=ND, smooth=True, grime=0.5)
    N.recolor(ob, lambda p, n, c: (0.72, 0.73, 0.72) if p.z > zt + 0.02 else None)       # silver roof, cream band
    # window frames: mullions at the corners and mid-sides, sill + head rails following the rounded plan
    bm = K.bm_new()
    lo, hi = rrect(CW - 0.02, CL - 0.02, RAD - 0.04, zw0 + 0.01), rrect(CW - 0.18, CL - 0.18, RAD - 0.09, zw1 - 0.01)
    npr = len(lo) // 4
    for k in range(4):
        for i in (0, npr // 2 + 0, npr - 1):
            j = k * npr + i
            K.cyl_bm(bm, lo[j], hi[j], 0.035, 6)
    for (a_, b_) in ((lo, 0.0), (hi, 0.0)):
        for i in range(len(a_)):
            K.cyl_bm(bm, a_[i], a_[(i + 1) % len(a_)], 0.03, 5)
    for sy in (-1, 1):                                                  # mid-mullions on the long glass runs
        for xx in (-0.28, 0.28):
            K.cyl_bm(bm, (xx, sy * (CL / 2 - 0.01), zw0 + 0.01), (xx, sy * (CL / 2 - 0.09), zw1 - 0.01), 0.03, 6)
    for sx in (-1, 1):
        for yy in (-0.35, 0.35):
            K.cyl_bm(bm, (sx * (CW / 2 - 0.01), yy, zw0 + 0.01), (sx * (CW / 2 - 0.09), yy, zw1 - 0.01), 0.03, 6)
    K.part(bm, 'paint_metal', name='win_frames', mat_tint=CREAM, node=ND, smooth=True)
    # belt moulding + drip rail + roof gutter (continuous rounded trims)
    bm = K.bm_new()
    for (w_, l_, rad_, z_, rr_) in ((CW + 0.06, CL + 0.06, RAD, zbelt, 0.03), (CW + 0.06, CL + 0.06, RAD + 0.01, zt + 0.07, 0.03),
                                    (CW - 0.02, CL - 0.02, RAD - 0.03, zb + 0.02, 0.025)):
        ring = rrect(w_, l_, rad_, z_)
        for i in range(len(ring)):
            K.cyl_bm(bm, ring[i], ring[(i + 1) % len(ring)], rr_, 5)
    K.part(bm, 'steel_galv', name='trims', node=ND, smooth=True, mat_tint=(0.7, 0.7, 0.68))
    # skirt under the floor + step
    bm = K.bm_new()
    C.loft_bm(bm, [rrect(CW - 0.06, CL - 0.06, RAD - 0.03, zb + 0.01), rrect(CW - 0.3, CL - 0.3, RAD - 0.1, 0.02)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    K.part(bm, 'paint_metal', name='skirt', mat_tint=(0.25, 0.25, 0.25), node=ND, smooth=True)
    # sliding door on the east side (proud leaf over the body, own glass pane, track above + below), grab rails
    dy = -CL * 0.12
    bm = K.bm_new()
    K.box_bm(bm, (CW / 2 + 0.05, dy + 0.18, zb + 0.5), (0.035, 0.8, 0.95))
    K.box_bm(bm, (CW / 2 - 0.02, dy + 0.18, zw1 + 0.02), (0.03, 0.82, 0.1))
    K.part(bm, 'paint_metal', name='door_slide', mat_tint=(0.62, 0.15, 0.12), node=ND)
    bm = K.bm_new()
    K.box_bm(bm, (CW / 2 + 0.1, dy + 0.35, zb + 1.92), (0.05, 1.5, 0.06))
    K.box_bm(bm, (CW / 2 + 0.08, dy + 0.35, zb + 0.03), (0.04, 1.5, 0.04))
    for yy in (dy - 0.35, dy + 0.75):
        K.cyl_bm(bm, (CW / 2 + 0.13, yy, zb + 0.4), (CW / 2 + 0.13, yy, zb + 1.5), 0.02, 6)
        for zz in (zb + 0.4, zb + 1.5):
            K.cyl_bm(bm, (CW / 2 + 0.04, yy, zz), (CW / 2 + 0.13, yy, zz), 0.02, 6)
    K.cyl_bm(bm, (CW / 2 + 0.08, dy + 0.5, zb + 0.95), (CW / 2 + 0.08, dy + 0.5, zb + 1.2), 0.018, 6)
    K.part(bm, 'steel_galv', name='grab_rails', node=ND, smooth=True)
    # roof: hatch, ventilator, number plate + lamp on the ends
    bm = K.bm_new()
    K.box_bm(bm, (0.0, 0.45, zt + 0.33), (0.5, 0.5, 0.06))
    K.cyl_bm(bm, (0.0, -0.55, zt + 0.28), (0.0, -0.55, zt + 0.42), 0.09, 10)
    K.cyl_bm(bm, (0.0, -0.55, zt + 0.42), (0.0, -0.55, zt + 0.47), 0.15, 10, r1=0.05)
    K.part(bm, 'paint_metal', name='roof_fittings', mat_tint=(0.55, 0.56, 0.55), node=ND, smooth=True)
    bm = K.bm_new()
    for sy in (-1, 1):
        K.box_bm(bm, (0.35, sy * (CL / 2 + 0.03), zbelt - 0.25), (0.3, 0.02, 0.2))
    K.part(bm, 'wood_paint', name='number_plates', mat_tint=(0.9, 0.88, 0.8), node=ND)
    bm = K.bm_new()
    for sy in (-1, 1):
        K.cyl_bm(bm, (-0.45, sy * (CL / 2 + 0.02), zt - 0.2), (-0.45, sy * (CL / 2 + 0.1), zt - 0.2), 0.07, 10)
    K.part(bm, 'glass_dirty', name='lamps', node=ND, smooth=True, mat_tint=(1.0, 0.9, 0.6))
    ZR = zb + CH + 1.4                       # rope contact height
    bm = K.bm_new()                          # gooseneck hanger + suspension yoke
    pts = [V((0, 0, zt + 0.2)), V((0, 0, zt + 0.55)), V((0, -0.25, zt + 0.85)), V((0, -0.3, ZR - 0.55)), V((0, -0.12, ZR - 0.28)), V((0, 0, ZR - 0.2))]
    for i in range(len(pts) - 1):
        K.cyl_bm(bm, pts[i], pts[i + 1], 0.06, 8)
    K.box_bm(bm, (0, 0, zt + 0.25), (0.9, 0.14, 0.1))
    for sx in (-0.4, 0.4):
        K.beam_bm(bm, V((sx, 0, zt + 0.22)), V((0, 0, zt + 0.55)), 0.05, 0.05)
    K.part(bm, 'steel_galv', name='hanger', node=ND, smooth=True, mat_tint=(0.45, 0.46, 0.45))
    bm = K.bm_new()                          # carriage: two side plates, 4 sheaves on axles, haul-rope grip
    for sx in (-0.13, 0.13):
        K.box_bm(bm, (sx, 0, ZR - 0.05), (0.03, 1.5, 0.36), taper=(1.0, 0.9))
    K.box_bm(bm, (0, 0, ZR - 0.22), (0.3, 1.2, 0.08))
    K.box_bm(bm, (0, 0.72, ZR - 0.42), (0.1, 0.18, 0.25))
    K.part(bm, 'steel_painted', name='carriage', node=ND, mat_tint=(0.5, 0.55, 0.5))
    bm = K.bm_new()
    for yy in (-0.52, -0.18, 0.18, 0.52):
        K.cyl_bm(bm, (-0.09, yy, ZR), (0.09, yy, ZR), 0.15, 14)
        K.cyl_bm(bm, (-0.16, yy, ZR), (0.16, yy, ZR), 0.035, 8)
    K.part(bm, 'cast_iron', name='sheaves', node=ND, smooth=True, mat_tint=(0.7, 0.68, 0.64))
    K.anchor('rope_point', (0, 0, ZR + 0.15), (0, 1, 0), node=ND)
    K.anchor('cabin_floor', (0, 0, zb), (0, 1, 0), node=ND)
    K.footprint(poly, 'NONE', 'cabin')
    C.A.meta['notes'].append('pivot = ground centre under the cabin; hang from the rope at anchor rope_point (subtract its offset)')
    for ob in C.A.parts:                     # everything (incl. kit windows) rides on the moving node
        if ob.get('kit_node') != 'decals':
            ob['kit_node'] = ND
else:
    H = 14.0
    def leg(k, z, b0=2.6, b1=0.7):
        s = b0 + (b1 - b0) * z / H
        return V(((1 if k in (0, 3) else -1) * s / 2, (1 if k in (0, 1) else -1) * s / 2, z))
    bm = K.bm_new()
    lv = 7
    for k in range(4):
        K.beam_bm(bm, leg(k, 0), leg(k, H), 0.14, 0.14)
    for i in range(lv):
        za, zb_ = H * i / lv, H * (i + 1) / lv
        zm = (za + zb_) / 2
        for k in range(4):
            j = (k + 1) % 4
            K.beam_bm(bm, leg(k, zb_), leg(j, zb_), 0.07, 0.07)
            K.beam_bm(bm, leg(k, za), leg(k, zm).lerp(leg(j, zm), 0.5), 0.05, 0.05)       # K-bracing
            K.beam_bm(bm, leg(j, za), leg(k, zm).lerp(leg(j, zm), 0.5), 0.05, 0.05)
    K.part(bm, 'steel_painted', name='tower', uv='beam', axis=(0, 0, 1), bisect=False, mat_tint=(0.6, 0.62, 0.58))
    bm = K.bm_new()
    K.ibeam_bm(bm, (-2.4, 0, H + 0.1), (2.4, 0, H + 0.1), 0.45, 0.3)                    # crossarm
    for sx in (-1, 1):
        K.beam_bm(bm, (sx * 0.35, 0, H - 1.2), (sx * 2.2, 0, H - 0.1), 0.1, 0.1)
    K.part(bm, 'steel_painted', name='crossarm', mat_tint=(0.55, 0.58, 0.54))
    bm = K.bm_new()
    for sx in (-1.1, 1.1):                                                           # track-rope saddles
        K.box_bm(bm, (sx, 0, H + 0.5), (0.3, 1.6, 0.3), taper=(1, 0.7))
    for sx in (-1.6, 1.6):                                                           # haul-rope sheaves
        K.cyl_bm(bm, (sx - 0.05, 0, H - 0.1), (sx + 0.05, 0, H - 0.1), 0.35, 16)
    K.part(bm, 'cast_iron', name='saddles', smooth=True)
    bm = K.bm_new()
    K.box_bm(bm, (0, 0, H - 0.25), (2.0, 1.0, 0.06))
    K.part(bm, 'steel_galv', name='platform')
    K.railing((-1.0, -0.5, H - 0.22), (1.0, -0.5, H - 0.22), 0.9, 'pipe')
    K.ladder((0, -1.35, 0), H - 0.3, (0, -1, 0), lean=0.02, mid='steel_galv')
    bm = K.bm_new()
    for k in range(4):
        p = leg(k, 0)
        K.box_bm(bm, (p.x, p.y, 0.15), (0.8, 0.8, 0.6), taper=(0.7, 0.7))
    K.part(bm, 'concrete_bunker', name='footings')
    K.footprint(N.rect(-1.6, -1.6, 1.6, 1.6), 'HIGH', 'pylon')
    for nm, sx, z in (('cable_track_w', -1.1, H + 0.68), ('cable_track_e', 1.1, H + 0.68), ('cable_haul_w', -1.6, H + 0.25), ('cable_haul_e', 1.6, H + 0.25)):
        K.anchor(nm, (sx, 0, z), (0, 1, 0))
    K.climb_meta((-1.3, -1.3), (1.3, -1.3), H)
if SNOW:
    N.snow()
K.finalize(os.path.join(OUT, name), ao_res=512, ao_samples=48, recenter=False)
