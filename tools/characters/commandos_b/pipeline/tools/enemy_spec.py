#!/usr/bin/env python3
"""enemy_spec.py - German enemy variety (character-bible §5.2-5.3) -> build_char specs.
  enemy_spec.py --type rifleman --variants 16 --out specs/gen [--seed 1] [--theatre europe|desert|norway]
Each variant gets a DIFFERENT head archetype (16 faces, bible §5.2) + seeded jitter on 6 minor modifiers, a skin-tone
preset, age/build/facial hair drawn from the type's table. The same PRNG (FNV-1a + mulberry32) is mirrored in
web/variety.js, which picks a prebuilt variant per spawn and enforces the 30 m / same-squad neighbour rule."""
import json, os, argparse


def fnv1a(s):
    h = 0x811c9dc5
    for ch in s.encode():
        h ^= ch; h = (h * 0x01000193) & 0xffffffff
    return h


def mulberry32(a):
    def r():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xffffffff
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xffffffff
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xffffffff)) & 0xffffffff
        return ((t ^ (t >> 14)) & 0xffffffff) / 4294967296
    return r


ARCH = {  # bible §5.2: 16 head archetypes as MPFB targets (values -1..1; names resolved by body.resolve_target)
    1: ('narrow oval, long nose', {'head/head-oval': .6, 'head/head-scale-horiz-decr': .3, 'nose/nose-scale-vert-incr': .5, 'chin/chin-width-decr': .2}),
    2: ('broad square, wide jaw', {'head/head-square': .7, 'chin/chin-width-incr': .6, 'chin/chin-jaw-drop-incr': .3, 'neck/neck-scale-horiz-incr': .3}),
    3: ('round, full cheeks, snub nose', {'head/head-round': .7, 'cheek/cheek-volume-incr': .6, 'nose/nose-scale-vert-decr': .4, 'nose/nose-point-up': .4, 'head/head-fat': .3}),
    4: ('long rectangular, big chin', {'head/head-rectangular': .7, 'head/head-scale-vert-incr': .3, 'chin/chin-height-incr': .5, 'chin/chin-prominent-incr': .4}),
    5: ('triangular, pointed chin, big ears', {'head/head-triangular': .6, 'chin/chin-width-decr': .5, 'ears/ear-scale-incr': .6, 'ears/ear-flap-incr': .3}),
    6: ('heart-shaped, high forehead', {'head/head-invertedtriangular': .6, 'forehead/forehead-scale-vert-incr': .6, 'chin/chin-width-decr': .3}),
    7: ('gaunt, prominent cheekbones', {'cheek/cheek-bones-incr': .7, 'cheek/cheek-volume-decr': .6, 'head/head-fat': -.4, 'eyes/eye-bag-incr': .3}),
    8: ('fleshy, double chin', {'head/head-fat': .6, 'neck/neck-double-incr': .6, 'cheek/cheek-volume-incr': .4, 'chin/chin-jaw-drop-incr': .2}),
    9: ('heavy brow ridge, deep-set eyes', {'eyebrows/eyebrows-trans-down': .6, 'eyebrows/eyebrows-angle-down': .3, 'forehead/forehead-trans-forward': .4, 'eyes/eye-push1-in': .4}),
    10: ('soft round, small nose (farm boy)', {'head/head-round': .4, 'nose/nose-scale-horiz-decr': .3, 'nose/nose-scale-vert-decr': .3, 'cheek/cheek-volume-incr': .3, 'eyes/eye-scale-incr': .2}),
    11: ('angular, high cheekbones, hollow cheeks', {'head/head-diamond': .5, 'cheek/cheek-bones-incr': .5, 'cheek/cheek-inner-decr': .5, 'chin/chin-prominent-incr': .3}),
    12: ('wide-set eyes, flat bridge', {'eyes/eye-trans-out': .5, 'nose/nose-width1-incr': .5, 'nose/nose-scale-depth-decr': .4}),
    13: ('aquiline nose, narrow lips', {'nose/nose-hump-incr': .7, 'nose/nose-point-down': .3, 'mouth/mouth-upperlip-volume-decr': .5, 'mouth/mouth-lowerlip-volume-decr': .4}),
    14: ('heavy jowls (older only)', {'head/head-fat': .4, 'neck/neck-double-incr': .4, 'mouth/mouth-angles-down': .4, 'cheek/cheek-trans-down': .5}),
    15: ('boyish, smooth (teen conscript)', {'head/head-age-decr': .6, 'head/head-round': .3, 'nose/nose-scale-vert-decr': .2, 'chin/chin-prominent-decr': .3}),
    16: ('rugged, weathered, broken nose', {'nose/nose-hump-incr': .4, 'nose/nose-curve-convex': .4, 'nose/nose-septumangle-incr': .4, 'chin/chin-prominent-incr': .3, 'head/head-square': .3}),
}
JITTER = ['nose/nose-scale-horiz-incr', 'nose/nose-scale-vert-incr', 'ears/ear-scale-incr', 'eyebrows/eyebrows-trans-up',
          'mouth/mouth-lowerlip-volume-incr', 'cheek/cheek-volume-incr']
SKIN = {  # 6 tint presets (multipliers on the MakeHuman skin albedo) + ruddiness
    'pale_pink': ([1.02, 0.97, 0.97], 0.25), 'fair': ([1.0, 0.98, 0.96], 0.12), 'fair_ruddy': ([1.03, 0.95, 0.92], 0.4),
    'light_olive': ([0.97, 0.95, 0.88], 0.08), 'weathered_tan': ([0.92, 0.84, 0.74], 0.2), 'sunburnt': ([1.05, 0.88, 0.80], 0.55)}
HAIR = [((0.62, 0.50, 0.30), .25), ((0.42, 0.30, 0.18), .30), ((0.28, 0.19, 0.11), .28), ((0.10, 0.08, 0.06), .14), ((0.45, 0.20, 0.08), .03)]
TYPES = {  # bible §5.3
    'rifleman': dict(age=(18, 30, 21), muscle=(.45, .65), weight=(.35, .6), fh={'none': .70, 'stubble': .25, 'moustache': .05}, glasses=.04,
                     outfit='heer_m40', headgear='m35', kit=['belt', 'ystraps', 'ammo_pouches', 'bread_bag', 'canteen', 'gasmask_can', 'bayonet'], weapon='kar98k'),
    'trooper': dict(age=(18, 30, 22), muscle=(.45, .65), weight=(.35, .6), fh={'none': .70, 'stubble': .25, 'moustache': .05}, glasses=.04,
                    outfit='heer_m40', headgear='m35', kit=['belt', 'ystraps', 'bread_bag', 'canteen', 'gasmask_can'], weapon='mp40'),
    'sergeant': dict(age=(24, 38, 30), muscle=(.55, .75), weight=(.4, .65), fh={'none': .55, 'moustache': .30, 'stubble': .15}, glasses=.06,
                     outfit='heer_m36', headgear='officer_cap', kit=['belt', 'ystraps', 'bread_bag', 'canteen'], weapon='mp40'),
    'officer': dict(age=(28, 52, 36), muscle=(.35, .6), weight=(.3, .7), fh={'none': .70, 'moustache': .20, 'stubble': .10}, glasses=.12,
                    outfit='officer_heer', headgear='officer_cap', kit=['belt'], weapon='walther_p38', headgear_badge=True),
    'mg': dict(age=(20, 32, 24), muscle=(.6, .8), weight=(.45, .7), fh={'none': .60, 'stubble': .40}, glasses=.03,
               outfit='heer_m40', headgear='m35', kit=['belt', 'ystraps', 'bread_bag', 'canteen', 'gasmask_can'], weapon='mg34'),
    'afrika': dict(age=(19, 30, 22), muscle=(.45, .65), weight=(.3, .5), fh={'none': .55, 'stubble': .40, 'moustache': .05}, glasses=.03,
                   outfit='dak', headgear='m35', headgear_color=(0.66, 0.58, 0.42), kit=['belt', 'ystraps', 'ammo_pouches', 'bread_bag', 'canteen'], weapon='kar98k', skin=['weathered_tan', 'sunburnt']),
    'winter': dict(age=(20, 35, 24), muscle=(.45, .65), weight=(.4, .6), fh={'stubble': .50, 'none': .35, 'moustache': .10, 'beard': .05}, glasses=.03,
                   outfit='winter_smock', headgear='m35', headgear_color=(0.80, 0.81, 0.78), kit=['belt', 'ammo_pouches'], weapon='kar98k', skin=['fair_ruddy', 'pale_pink', 'fair']),
    'crew': dict(age=(19, 28, 22), muscle=(.45, .6), weight=(.35, .55), fh={'none': .80, 'stubble': .20}, glasses=.03,
                 outfit='panzer', headgear='side_cap', headgear_color=(0.08, 0.08, 0.085), kit=['belt'], weapon='walther_p38'),
}


def draw(tname, variant, seed=1, theatre=None):
    T = TYPES[tname]
    r = mulberry32(fnv1a(f'{tname}:{seed}:{variant}'))
    arch = (variant % 16) + 1
    lo, hi, mode = T['age']
    a = lo + (hi - lo) * (r() + r() + r()) / 3            # rough triangular around the middle
    a = 0.5 * a + 0.5 * mode + (r() - 0.5) * 4
    if arch == 14 and a < 30:
        arch = 7                                            # heavy jowls only on older men
    if arch == 15 and a > 24:
        arch = 10
    mods = {k: v * 1.4 for k, v in ARCH[arch][1].items()}      # archetype strength (faces must NOT read alike)
    for j in JITTER:
        mods[j] = mods.get(j, 0) + (r() - 0.5) * 0.5
    tones = T.get('skin', list(SKIN))
    tone = tones[int(r() * len(tones)) % len(tones)]
    tint, ruddy = SKIN[tone]
    u = r(); acc = 0; fh = 'none'
    for k, p in T['fh'].items():
        acc += p
        if u <= acc:
            fh = k; break
    u = r(); acc = 0; hair = HAIR[0][0]
    for c, p in HAIR:
        acc += p
        if u <= acc:
            hair = c; break
    h = max(1.64, min(1.90, 1.74 + (sum(r() for _ in range(6)) - 3) * 0.06 * 0.7))
    sid = f'{tname}_v{variant:02d}'
    spec = {
        'id': sid, 'enemy': {'soldierType': tname, 'variant': variant, 'archetype': arch, 'archetype_name': ARCH[arch][0], 'seed': seed, 'skinTone': tone, 'facialHair': fh},
        'body': {'age_years': round(a, 1), 'muscle': round(T['muscle'][0] + r() * (T['muscle'][1] - T['muscle'][0]), 3),
                 'weight': round(T['weight'][0] + r() * (T['weight'][1] - T['weight'][0]), 3), 'proportions': 0.55, 'height_m': round(h, 3),
                 'modifiers': {k: round(v, 3) for k, v in mods.items()}},
        'skin': {'base': 'young_caucasian_male' if a < 30 else ('middleage_caucasian_male' if a < 45 else 'old_caucasian_male'),
                 'tint': tint, 'ruddy': ruddy, 'stubble': {'stubble': 0.45, 'none': 0.1}.get(fh, 0.2)},
        'brows': {'asset': f'eyebrow{1 + int(r() * 12):03d}', 'color': [c * 0.8 for c in hair]},
        'hair': {'style': 'crop', 'color': list(hair)},
        'facial_hair': fh if fh in ('moustache', 'beard') else 'none', 'glasses': r() < T['glasses'],
        'outfit': T['outfit'], 'outfit_opts': {}, 'kit': T['kit'],
        'headgear': {'type': T['headgear'], **({'color': list(T['headgear_color'])} if 'headgear_color' in T else {}), **({'badge': True} if T.get('headgear_badge') else {})},
        'weapon': {'primary': T['weapon']},
    }
    return spec


def _cum(w):
    acc = 0
    for k, p in w.items():
        acc += p; yield k, acc


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--type', default='rifleman'); ap.add_argument('--variants', type=int, default=16)
    ap.add_argument('--seed', type=int, default=1); ap.add_argument('--out', default='specs/gen')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for v in range(a.variants):
        s = draw(a.type, v, a.seed)
        json.dump(s, open(os.path.join(a.out, s['id'] + '.json'), 'w'), indent=1)
        e = s['enemy']
        print(s['id'], f"arch {e['archetype']:2d} {e['archetype_name'][:28]:28s} age {s['body']['age_years']:5.1f} h {s['body']['height_m']} {e['skinTone']:13s} {e['facialHair']}")
