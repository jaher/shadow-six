# body.py - MPFB body from a character spec (bible §0.4 slider formula).
import bpy, os, gzip, math
import addon_utils
from common import *

addon_utils.enable('bl_ext.user_default.mpfb', default_set=True)
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService
from bl_ext.user_default.mpfb.services.rigservice import RigService

TARGET_DIR = os.path.join(MPFB_SYS, 'targets')
_INDEX = None
PAIRS = [('incr', 'decr'), ('up', 'down'), ('in', 'out'), ('forward', 'backward'), ('convex', 'concave'),
         ('compress', 'uncompress')]


def _index():
    global _INDEX
    if _INDEX is None:
        _INDEX = {}
        for d, _, fs in os.walk(TARGET_DIR):
            for f in fs:
                if f.endswith('.target.gz'):
                    _INDEX[f[:-10]] = os.path.join(d, f)
    return _INDEX


def age_macro(years):
    # bible §0.4: 0.5 = 25 y, +1/130 per year above 25 (below 25: MakeHuman maps 1..25 y onto 0.1875..0.5)
    return 0.5 + (years - 25) / 130.0 if years >= 25 else max(0.0, 0.1875 + (years - 11) * (0.3125 / 14))


def resolve_target(name, value):
    """'head/head-square' +0.8 | 'nose/nose-hump-decr' 0.4 | 'cheek/cheek-bones-incr' (both sides) | negative flips pole.
    returns [(path, weight)]"""
    idx = _index()
    n = name.split('/')[-1]
    if value < 0:
        for a, b in PAIRS:
            if n.endswith('-' + a):
                n = n[:-len(a)] + b; value = -value; break
            if n.endswith('-' + b):
                n = n[:-len(b)] + a; value = -value; break
    out = []
    # bipolar category name (e.g. 'head-fat-decr-incr', 'nose-trans-in-out') or bare 'head-fat' -> pick the pole file
    for a, b in PAIRS:
        for lo, hi in ((b, a), (a, b)):
            suf = '-' + lo + '-' + hi
            if n.endswith(suf):
                n = n[:-len(suf)] + '-' + (hi if value >= 0 else lo); value = abs(value); break
    if n not in idx and not any(s + n in idx for s in ('l-', 'r-')):
        for a, b in PAIRS:
            if n + '-' + a in idx or 'l-' + n + '-' + a in idx:
                n = n + '-' + (a if value >= 0 else b); value = abs(value); break
    if n in idx:
        out.append((idx[n], value))
    else:
        for side in ('l-', 'r-'):
            if side + n in idx:
                out.append((idx[side + n], value))
    if not out:
        log('WARNING unknown target', name)
    return out


def build_body(spec):
    b = spec['body']
    macro = {"gender": 1.0, "age": age_macro(b.get('age_years', 25)), "muscle": b.get('muscle', 0.5),
             "weight": b.get('weight', 0.5), "proportions": b.get('proportions', 0.5), "height": b.get('height_macro', 0.5),
             "cupsize": 0.5, "firmness": 0.5,
             "race": b.get('race', {"caucasian": 0.94, "african": 0.03, "asian": 0.03})}
    human = HumanService.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True,
                                      feet_on_ground=True, scale=0.1, macro_detail_dict=macro)
    human.name = 'body'
    for k, v in (b.get('modifiers') or {}).items():
        for path, w in resolve_target(k, v):
            TargetService.load_target(human, path, weight=w)
    return human


def body_height(human):
    ms = [v.co for v in human.data.vertices]
    body_vg = human.vertex_groups.get('body')
    dg = bpy.context.evaluated_depsgraph_get()
    ev = human.evaluated_get(dg)
    zs = [v.co.z for v in ev.data.vertices]
    return max(zs) - min(zs), min(zs)


def calibrated_body(spec):
    """MPFB height macro is calibrated against the measured mesh height (bible §0.4)."""
    target = spec['body'].get('height_m')
    if not target:
        return build_body(spec)
    pts = []
    for hm in (0.5, 1.0):
        spec['body']['height_macro'] = hm
        h = build_body(spec)
        H, _ = body_height(h)
        pts.append((hm, H))
        bpy.data.objects.remove(h, do_unlink=True)
    (a, ha), (c, hc) = pts
    hm = a + (target - ha) * (c - a) / (hc - ha)
    spec['body']['height_macro'] = max(0.0, min(1.0, hm))
    h = build_body(spec)
    H, _ = body_height(h)
    log(f'height calib: macro {hm:.3f} -> {H:.3f} m (target {target})')
    if abs(H - target) > 0.01:  # tall outliers (2.0 m) exceed the macro range: small uniform scale on top
        s = target / H
        h.scale = (s, s, s)
        bpy.context.view_layer.update()
        activate(h)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        log(f'  extra uniform scale {s:.3f}')
    return h


def add_asset(human, kind, name, mat='MAKESKIN'):
    folder = {'Eyes': 'eyes', 'Eyebrows': 'eyebrows', 'Eyelashes': 'eyelashes', 'Hair': 'hair', 'Clothes': 'clothes',
              'Teeth': 'teeth', 'Tongue': 'tongue'}[kind]
    p = os.path.join(ASSETS, folder, name, name.split('/')[-1] + '.mhclo')
    try:
        o = HumanService.add_mhclo_asset(p, human, asset_type=kind, subdiv_levels=0, material_type=mat)
        log('asset', kind, name, o.name if o else None, len(o.data.polygons) if o else 0)
        return o
    except Exception as e:
        log('asset FAILED', kind, name, e)
        return None


def finalize_body(human, spec):
    """rig + skin + face assets, bake shape keys, ground, refit rig. Returns (human, rig, parts dict)."""
    rig = HumanService.add_builtin_rig(human, 'game_engine')
    sk = spec.get('skin', {}).get('base', 'middleage_caucasian_male')
    HumanService.set_character_skin(os.path.join(ASSETS, 'skins', sk, sk + '.mhmat'), human, skin_type='GAMEENGINE')
    parts = {'body': human}
    parts['eyes'] = add_asset(human, 'Eyes', 'low-poly')
    parts['brows'] = add_asset(human, 'Eyebrows', spec.get('brows', {}).get('asset', 'eyebrow001'))
    parts['lashes'] = add_asset(human, 'Eyelashes', spec.get('lashes', 'eyelashes01'))
    hs = spec.get('hair', {}).get('asset')
    if hs:
        parts['hair'] = add_asset(human, 'Hair', hs)
    for o in [x for x in bpy.data.objects if x.type == 'MESH']:
        if o.data.shape_keys:
            activate(o)
            bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    # ground: lowest body vertex (helpers masked) -> z=0
    dg = bpy.context.evaluated_depsgraph_get()
    zmin = min(v.co.z for v in human.evaluated_get(dg).data.vertices)
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.data.transform(Matrix.Translation((0, 0, -zmin)))
            o.data.update()
    activate(rig)
    RigService.refit_existing_armature(rig, human)
    bpy.context.view_layer.update()
    b = rig.data.bones
    log('rig refit: head', tuple(round(x, 3) for x in b['head'].head_local), 'foot_l', tuple(round(x, 3) for x in b['foot_l'].head_local))
    return human, rig, parts
