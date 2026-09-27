#!/usr/bin/env python3
"""enemy_types.py - German enemy roster (bible §5.2-5.5, design-spec §4.1) -> build specs for enemies/blender/build_enemy.py
  python3 enemy_types.py --out ../specs [--types rifleman,sentry,...] [--seed 1]
Extends pipeline/tools/enemy_spec.py (same 16 archetypes, skin presets, hair odds, FNV-1a + mulberry32 PRNG).
Per variant: head archetype from a per-type permutation of the 16 (no repeats inside the first 16 variants of a type),
+-0.25 jitter on 6 minor face modifiers, skin tone, age (-> MPFB age + skin texture band), build, height,
facial hair, glasses, brows, hair colour (greying with age), uniform tint (+-6 %), wear/dirt, kit extras."""
import json, os, sys, argparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'pipeline', 'tools'))
from enemy_spec import ARCH, JITTER, HAIR, fnv1a, mulberry32

# skin tone presets (bible §5.2), spread wider than pipeline/tools/enemy_spec.SKIN so tones read apart under ACES
SKIN = {'pale_pink': ([1.05, 0.95, 0.96], 0.30), 'fair': ([1.0, 0.97, 0.95], 0.12), 'fair_ruddy': ([1.04, 0.92, 0.88], 0.45),
        'light_olive': ([0.94, 0.90, 0.79], 0.06), 'weathered_tan': ([0.86, 0.75, 0.62], 0.22), 'sunburnt': ([1.02, 0.80, 0.70], 0.6)}
# proportion layer: every variant also gets a gaussian draw on these (sigma ~0.3, clamp +-0.6) -> real people differ
# mostly in face width/length, nose, mouth, eye spacing, chin and ears, on top of the archetype
PROP = ['head/head-scale-horiz-incr', 'head/head-scale-vert-incr', 'head/head-scale-depth-incr', 'nose/nose-scale-depth-incr',
        'mouth/mouth-scale-horiz-incr', 'eyes/eye-scale-incr', 'eyes/eye-trans-out', 'eyes/eye-trans-up', 'chin/chin-height-incr',
        'chin/chin-width-incr', 'chin/chin-prominent-incr', 'ears/ear-flap-incr', 'eyebrows/eyebrows-angle-up', 'cheek/cheek-bones-incr',
        'forehead/forehead-scale-vert-incr', 'neck/neck-scale-horiz-incr', 'mouth/mouth-upperlip-height-incr', 'nose/nose-width2-incr']

M35 = {'type': 'm35'}
T = {  # count = prebuilt variants per type
    'rifleman': dict(n=32, age=(18, 30, 21), muscle=(.45, .65), weight=(.35, .6), fh={'none': .70, 'stubble': .25, 'moustache': .05}, glasses=.04,
                     outfit='heer_m40', hg=M35, kit=['belt', 'ystraps', 'ammo_pouches', 'bread_bag', 'canteen', 'gasmask_can', 'bayonet'], weapon='kar98k'),
    'trooper': dict(n=8, age=(18, 30, 22), muscle=(.45, .65), weight=(.35, .6), fh={'none': .70, 'stubble': .25, 'moustache': .05}, glasses=.04,
                    outfit='heer_m40', hg=M35, kit=['belt', 'ystraps', 'mp_pouches', 'bread_bag', 'canteen', 'gasmask_can'], weapon='mp40'),
    'sentry': dict(n=8, age=(19, 42, 27), muscle=(.4, .6), weight=(.4, .75), fh={'none': .60, 'stubble': .25, 'moustache': .15}, glasses=.05,
                   outfit='greatcoat', hg=M35, kit=['coat_belt', 'ammo_pouches', 'gasmask_can'], weapon='kar98k'),
    'sergeant': dict(n=6, age=(24, 38, 30), muscle=(.55, .75), weight=(.4, .65), fh={'none': .55, 'moustache': .30, 'stubble': .15}, glasses=.06,
                     outfit='heer_m36', hg={'type': 'officer_cap', 'badge': True, 'color': (0.44, 0.46, 0.40), 'visor_color': (0.03, 0.03, 0.03)},
                     kit=['belt', 'ystraps', 'bread_bag', 'canteen', 'holster_l', 'map_case', 'binoculars', 'tresse'], weapon='luger'),
    'officer': dict(n=6, age=(28, 52, 36), muscle=(.35, .6), weight=(.3, .7), fh={'none': .70, 'moustache': .20, 'stubble': .10}, glasses=.12,
                    outfit='officer_heer', hg={'type': 'officer_cap', 'badge': True, 'cords': True}, kit=['belt_brown', 'holster_l_brown'], weapon='walther_p38'),
    'mg': dict(n=6, age=(20, 32, 24), muscle=(.6, .8), weight=(.45, .7), fh={'none': .60, 'stubble': .40}, glasses=.03,
               outfit='heer_m40', hg=M35, kit=['belt', 'ystraps', 'holster_l', 'mg_tool_pouch', 'barrel_case', 'canteen', 'gasmask_can'], weapon='mg34'),
    'engineer': dict(n=6, age=(22, 38, 28), muscle=(.6, .8), weight=(.45, .7), fh={'none': .50, 'stubble': .40, 'moustache': .10}, glasses=.04,
                     outfit='heer_m40', outfit_opts={'rolled': True, 'collar': (0.07, 0.07, 0.07)}, hg=M35,
                     kit=['belt', 'ystraps', 'satchel_charge', 'shovel_back', 'work_gloves', 'gasmask_can'], weapon=None),
    'crew': dict(n=6, age=(19, 28, 22), muscle=(.45, .6), weight=(.35, .55), fh={'none': .80, 'stubble': .20}, glasses=.03, height=(1.66, 1.78),
                 outfit='panzer', hg={'type': 'side_cap', 'color': (0.08, 0.08, 0.085)}, kit=['belt', 'holster_l', 'headphones'], weapon='walther_p38'),
    'afrika': dict(n=12, age=(19, 30, 22), muscle=(.45, .65), weight=(.3, .5), fh={'none': .55, 'stubble': .40, 'moustache': .05}, glasses=.03,
                   outfit='dak', hg=None, kit=['belt_web', 'ystraps_web', 'ammo_pouches', 'bread_bag', 'canteen'], weapon='kar98k',
                   skin=['weathered_tan', 'sunburnt', 'weathered_tan', 'fair_ruddy']),
    'winter': dict(n=8, age=(20, 35, 24), muscle=(.45, .65), weight=(.4, .6), fh={'stubble': .50, 'none': .35, 'moustache': .10, 'beard': .05}, glasses=.03,
                   outfit='winter_smock', hg={'type': 'm35', 'color': (0.80, 0.81, 0.78)}, kit=['belt', 'ammo_pouches'], weapon='kar98k',
                   skin=['fair_ruddy', 'pale_pink', 'fair', 'fair_ruddy']),
}
SILHOUETTE = {'rifleman': 'M35 helmet, field grey, Kar98k', 'trooper': 'M35 helmet, MP40', 'sentry': 'M35 helmet, long greatcoat, Kar98k',
              'sergeant': 'peaked cap, Luger, binoculars', 'officer': 'peaked cap with cords, open collar, breeches, riding boots',
              'mg': 'M35 helmet, MG34, barrel case', 'engineer': 'M35 helmet, rolled sleeves, gloves, satchel charge, shovel',
              'crew': 'black Panzer wrap jacket, black side cap', 'afrika': 'tropical khaki, sand helmet / long-peaked cap / pith',
              'winter': 'white snow smock, white-washed helmet', 'general': 'wide, paunchy, grey leather greatcoat, peaked cap with cords'}
EXPR = {'frown': ['eyebrows-left-down', 'eyebrows-right-down'], 'squint': ['eye-left-slit', 'eye-right-slit'],
        'pressed': ['mouth-compression'], 'downturn': ['mouth-depression'], 'worried': ['eyebrows-left-inner-up', 'eyebrows-right-inner-up'],
        'wide': ['eye-left-opened-up', 'eye-right-opened-up'], 'sneer': ['nose-left-elevation'], 'lipout': ['mouth-protusion']}
IRIS = [((0.36, 0.50, 0.66), .30), ((0.45, 0.52, 0.56), .15), ((0.38, 0.47, 0.32), .10), ((0.42, 0.33, 0.20), .18), ((0.25, 0.16, 0.10), .17), ((0.30, 0.42, 0.58), .10)]


def pick(r, table):
    u = r(); acc = 0
    for k, p in table.items():
        acc += p
        if u <= acc:
            return k
    return list(table)[-1]


def perm16(tname, cycle):
    r = mulberry32(fnv1a(f'perm:{tname}:{cycle}'))
    a = list(range(1, 17))
    for i in range(15, 0, -1):
        j = int(r() * (i + 1)); a[i], a[j] = a[j], a[i]
    return a


def jit3(r, amt):
    v = 1 + (r() - 0.5) * 2 * amt           # value
    h = (r() - 0.5) * 2 * amt * 0.6          # warm/cool shift
    return [round(v * (1 + h), 3), round(v, 3), round(v * (1 - h), 3)]


def draw(tname, variant, seed=1):
    t = T[tname]
    r = mulberry32(fnv1a(f'{tname}:{seed}:{variant}'))
    lo, hi, mode = t['age']
    allowed = [k for k in perm16(tname, variant // 16) if not (k == 14 and hi < 31) and not (k == 15 and lo > 23)]
    arch = allowed[variant % len(allowed)]
    a = lo + (hi - lo) * (r() + r() + r()) / 3
    a = max(lo, min(hi, 0.5 * a + 0.5 * mode + (r() - 0.5) * 6))
    if tname == 'sentry' and variant % 3 == 2:
        a = 35 + r() * 7                                    # Norway garrison reservist
    if arch == 14:
        a = max(a, 31 + r() * max(0.0, min(8, hi - 31)))  # heavy jowls: older men only
    if arch == 15:
        a = min(a, max(lo, 18 + r() * 5))                   # boyish: teen/young conscripts only
    strength = 1.7 if variant < 16 else 1.3
    mods = {k: v * strength for k, v in ARCH[arch][1].items()}
    for j in JITTER:
        mods[j] = mods.get(j, 0) + (r() - 0.5) * 0.5
    for j in PROP:
        g = (r() + r() + r() + r() - 2.0) * 0.7           # ~N(0, 0.4)
        mods[j] = max(-1.0, min(1.0, mods.get(j, 0) + max(-0.75, min(0.75, g))))
    # resting expression (MPFB expression units, subtle): each man gets 1-2 of these -> individual 'face at rest'
    ex = list(EXPR)
    for k in range(1 + int(r() * 2)):
        e = ex.pop(int(r() * len(ex)))
        for t_ in EXPR[e]:
            mods[t_] = round(0.18 + r() * 0.3, 3)
    old = max(0.0, (a - 30) / 20)
    if a > 28:
        mods['head/head-age-incr'] = round(min(0.9, (a - 28) / 26), 3)       # MPFB head age: sag, lids, lines
    elif a < 21:
        mods['head/head-age-decr'] = round(mods.get('head/head-age-decr', 0) + (21 - a) * 0.08, 3)
    if old > 0:                                              # a little sag with age
        mods['cheek/cheek-trans-down'] = mods.get('cheek/cheek-trans-down', 0) + 0.3 * old
    tones = t.get('skin', list(SKIN))
    tone = tones[int(r() * len(tones)) % len(tones)]
    if variant >= 16:
        prev = [draw(tname, v, seed) for v in range(16)]
        used = {p['enemy']['skinTone'] for p in prev if p['enemy']['archetype'] == arch}
        k = 0
        while tone in used and k < 12:
            tone = tones[(tones.index(tone) + 1) % len(tones)] if tone in tones else tones[0]; k += 1
    tint, ruddy = SKIN[tone]
    tint = [round(c * (1 + (r() - 0.5) * 0.08), 3) for c in tint]      # +-4 % jitter
    fh = pick(r, t['fh'])
    u = r(); acc = 0; hair = HAIR[0][0]
    for c, p in HAIR:
        acc += p
        if u <= acc:
            hair = c; break
    grey = max(0.0, (a - 34) / 25)
    hair = [round(c * (1 - grey) + 0.52 * grey, 3) for c in hair]
    hl, hh = t.get('height', (1.64, 1.90))
    h = max(hl, min(hh, 1.74 + (sum(r() for _ in range(6)) - 3) * 0.06 * 0.7))
    muscle = t['muscle'][0] + r() * (t['muscle'][1] - t['muscle'][0])
    weight = t['weight'][0] + r() * (t['weight'][1] - t['weight'][0])
    if tname == 'sentry' and a > 34:
        weight = min(0.85, weight + 0.12)
    glasses = r() < t['glasses']
    u = r(); acc = 0; iris = IRIS[0][0]
    for c_, p_ in IRIS:
        acc += p_
        if u <= acc:
            iris = c_; break
    brows = f'eyebrow{1 + int(r() * 12):03d}'
    oo = dict(t.get('outfit_opts', {}))
    oo['tint_mul'] = jit3(r, 0.06)
    oo['wear'] = round(0.08 + r() * 0.34, 3)
    kit = list(t['kit'])
    hg = dict(t['hg']) if t['hg'] else None
    extras = []
    if 'canteen' in kit and r() < 0.15:
        kit.remove('canteen'); extras.append('no canteen')
    if tname == 'afrika':
        u = r()
        hg = {'type': 'm35', 'color': (0.64, 0.57, 0.42)} if u < 0.6 else ({'type': 'dak_cap', 'peak': 0.075} if u < 0.9 else {'type': 'pith'})
        if r() < 0.3:
            hg['goggles'] = True
        if r() < 0.2:
            oo['shorts'] = True
        if r() < 0.4:
            oo['rolled'] = True; extras.append('rolled sleeves')
    if tname == 'winter' and r() < 0.25:
        hg = {'type': 'field_cap', 'color': (0.44, 0.45, 0.39), 'peak': 0.05}; extras.append('Bergmuetze')
    if tname == 'afrika' and variant == 11:
        hg = {'type': 'pith'}; extras.append('pith helmet (early 1942)')    # guarantee the bible's 10 % pith read in the set
    if tname == 'winter' and variant == 5:
        hg = {'type': 'field_cap', 'color': (0.44, 0.45, 0.39), 'peak': 0.05}; extras.append('Bergmuetze')
    if hg and hg['type'] == 'dak_cap':
        hg['color'] = (0.63, 0.56, 0.39)
    if tname == 'crew' and r() < 0.5:
        kit.remove('headphones')
    if hg and hg['type'] == 'm35':
        hg['wear'] = round(r(), 2)
    sid = f'{tname}_v{variant:02d}'
    extra_hg = hg and (hg.get('cords') or hg.get('goggles'))
    return {
        'budget': {'lod0': 11550 if extra_hg else 11800, 'lod1': 5000, 'lod2': 2000},
        'id': sid,
        'enemy': {'soldierType': tname, 'variant': variant, 'archetype': arch, 'archetype_name': ARCH[arch][0], 'seed': seed,
                  'skinTone': tone, 'facialHair': fh, 'glasses': glasses, 'age': round(a, 1), 'extras': extras,
                  'key': f'{arch}|{tone}|{fh}|{int(glasses)}', 'silhouette': SILHOUETTE[tname]},
        'body': {'age_years': round(a, 1), 'muscle': round(muscle, 3), 'weight': round(weight, 3), 'proportions': 0.55, 'height_m': round(h, 3),
                 'modifiers': {k: round(v, 3) for k, v in mods.items()}},
        'skin': {'base': 'young_caucasian_male' if a < 27 else ('middleage_caucasian_male' if a < 45 else 'old_caucasian_male'),
                 'tint': tint, 'ruddy': ruddy, 'stubble': {'stubble': 0.45, 'beard': 1.0, 'none': 0.08}.get(fh, 0.2),
                 'complexion': {'freckles': round(r() * (0.8 if tone in ('pale_pink', 'fair', 'fair_ruddy') else 0.2), 2),
                                'moles': int(r() * 3), 'scar': r() < 0.12, 'lines': round(min(1.0, old + r() * 0.25), 2), 'seed': variant * 7 + 3}},
        'eyes': {'iris': list(iris)},
        'brows': {'asset': brows, 'color': [round(c * 0.8, 3) for c in hair]},
        'hair': {'style': 'crop', 'color': hair},
        'facial_hair': 'moustache' if fh == 'moustache' else 'none', 'glasses': glasses,
        'outfit': t['outfit'], 'outfit_opts': oo, 'kit': kit, 'headgear': hg,
        'weapon': {'primary': t['weapon']} if t['weapon'] else {},
    }


def general():
    """SS-Gruppenfuehrer Schleper (bible §5.5): generic heavy-set man of ~52; NO runes/skull/eagle; no moustache/glasses/scar."""
    return {
        'budget': {'lod0': 11550, 'lod1': 5000, 'lod2': 2000},
        'id': 'general_schleper',
        'enemy': {'soldierType': 'general', 'variant': 0, 'archetype': 14, 'archetype_name': 'heavy jowls + broad square (bespoke)', 'seed': 1,
                  'skinTone': 'pale_pink', 'facialHair': 'none', 'glasses': False, 'age': 52, 'extras': ['walk 0.8x', 'hands behind back'],
                  'key': 'general', 'silhouette': SILHOUETTE['general'], 'walkSpeedScale': 0.8},
        'body': {'age_years': 52, 'muscle': 0.45, 'weight': 0.8, 'proportions': 0.45, 'height_m': 1.80,
                 'modifiers': {'head/head-age-incr': 0.9, 'head/head-fat': 0.7, 'head/head-square': 0.5, 'neck/neck-double-incr': 0.8, 'neck/neck-scale-horiz-incr': 0.5,
                               'cheek/cheek-trans-down': 0.6, 'mouth/mouth-angles-down': 0.6, 'mouth/mouth-upperlip-volume-decr': 0.5,
                               'mouth/mouth-lowerlip-volume-decr': 0.3, 'nose/nose-scale-horiz-incr': 0.4, 'nose/nose-flaring-incr': 0.3,
                               'eyes/eye-scale-decr': 0.3, 'eyes/eye-bag-incr': 0.4, 'chin/chin-width-incr': 0.4, 'stomach/stomach-pregnant-incr': 0.35}},
        'skin': {'base': 'old_caucasian_male', 'tint': [1.03, 0.96, 0.95], 'ruddy': 0.45, 'stubble': 0.05,
                 'complexion': {'freckles': 0.0, 'moles': 1, 'scar': False, 'lines': 0.9, 'veins': 0.8, 'seed': 99}},
        'eyes': {'iris': [0.55, 0.62, 0.68]},
        'brows': {'asset': 'eyebrow006', 'color': [0.42, 0.40, 0.37]},
        'hair': {'style': 'crop', 'color': [0.55, 0.54, 0.51], 'length': 0.004},
        'facial_hair': 'none', 'glasses': False,
        'outfit': 'general_coat', 'outfit_opts': {'wear': 0.03, 'tint_mul': [1, 1, 1]},
        'kit': ['coat_belt_brown', 'tabs_general', 'boards_silver'],
        'headgear': {'type': 'officer_cap', 'badge': True, 'cords': True, 'color': (0.42, 0.44, 0.40)},
        'weapon': {},
    }


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'specs'))
    ap.add_argument('--types', default=','.join(T) + ',general'); ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--n', type=int, default=0)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    for tn in a.types.split(','):
        specs = [general()] if tn == 'general' else [draw(tn, v, a.seed) for v in range(a.n or T[tn]['n'])]
        for s in specs:
            json.dump(s, open(os.path.join(a.out, s['id'] + '.json'), 'w'), indent=1)
            e = s['enemy']
            print(f"{s['id']:18s} arch {e['archetype']:2d} {e['archetype_name'][:26]:26s} age {s['body']['age_years']:5.1f} h {s['body']['height_m']:.2f} "
                  f"{e['skinTone']:13s} {e['facialHair']:9s} gl={int(e['glasses'])} hg={(s['headgear'] or {}).get('type')}")
