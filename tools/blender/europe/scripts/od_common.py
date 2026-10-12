"""Shared helpers for the M19 Oldenburg coal-mine / V2-base assets (Lower Saxony, January 1945: frost, coal dust,
no snow cover). argv after '--': outroot variant seed."""
import sys, os, math
sys.path.insert(0, '<claude-tmp>')
from eu_common import K, V, SHUTTER, DOOR, finish, roof_tone, roof_decals, eave_streaks, use_cheap_windows, use_cheap_doors
import kit_core as C
import bmesh

BRICK_T = (0.82, 0.66, 0.58)        # north-German red-brown clinker
COAL_GRIME = 1.3                    # extra grime on everything near the pit


def args(default='a'):
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return (a[0] if a else '/tmp/out'), (a[1] if len(a) > 1 else default), (int(a[2]) if len(a) > 2 else 1)


def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def posts(pts, z0, z1, s=0.2, mid='timber_creosote', name='posts', tint=(0.5, 0.45, 0.4)):
    bm = bmesh.new()
    for (x, y) in pts:
        K.box_bm(bm, (x, y, (z0 + z1) / 2), (s, s, z1 - z0))
    K.part(bm, mid, name=name, mat_tint=tint, uv='beam', axis=(0, 0, 1))


def braces(pairs, s=0.12, mid='timber_creosote', name='braces', tint=(0.5, 0.45, 0.4)):
    """Diagonal timber braces: pairs of 3D points."""
    bm = bmesh.new()
    for a, b in pairs:
        K.beam_bm(bm, a, b, s, s)
    K.part(bm, mid, name=name, mat_tint=tint, uv='beam', axis=(0, 0, 1))


def flagpole(x, y, z0, z1, name='flagpole'):
    bm = bmesh.new()
    K.cyl_bm(bm, (x, y, z0), (x, y, z1), 0.045, 6)
    K.cyl_bm(bm, (x, y, z1), (x, y, z1 + 0.1), 0.07, 6)
    K.part(bm, 'cast_iron', name=name, mat_tint=(0.3, 0.3, 0.3), bisect=False)
    K.anchor('flag', (x + 0.05, y, z1 - 0.1), (1, 0, 0), kind='flag', w=1.5, h=1.0)


def coal_dust(poly_edges, n=6, seed=1, z=0.5, alpha=0.55):
    """Coal-black splash at the wall foot along (a, b, normal) edges."""
    import random
    rr = random.Random(seed)
    for (a, b, nrm) in poly_edges:
        for i in range(n):
            t = rr.uniform(0.1, 0.9)
            p = (a[0] + (b[0] - a[0]) * t + nrm[0] * 0.02, a[1] + (b[1] - a[1]) * t + nrm[1] * 0.02, z)
            K.decal('dirt_splash', p, (nrm[0], nrm[1], 0), rr.uniform(1.2, 2.2), 0.9, alpha=alpha)


def stovepipe(x, y, z0, z1):
    bm = bmesh.new()
    K.cyl_bm(bm, (x, y, z0), (x, y, z1), 0.09, 10)
    K.cyl_bm(bm, (x, y, z1), (x, y, z1 + 0.14), 0.16, 10, r1=0.04)
    K.part(bm, 'cast_iron', name='stovepipe', mat_tint=(0.3, 0.29, 0.27), smooth=True)
    K.anchor('smoke', (x, y, z1 + 0.2), (0, 0, 1), kind='smoke')
