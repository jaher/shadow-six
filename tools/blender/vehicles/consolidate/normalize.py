"""Unify the two vehicle sidecar formats (kit `<variant>.kit.json` and armour `<asset>.veh.json`) into one runtime
schema, written next to the shipped GLB as `<model>.json` (read by src/art/vehicle-library.js).
Coordinates: glTF model space in metres, +x = vehicle LEFT, y up, +z = vehicle front, pivot = ground centre."""
COORDS = 'glTF model space, metres: +x = vehicle LEFT, y up, +z = vehicle front; root pivot = ground centre'
KIT_SKIP = {'sockets', 'emitters', 'contacts', 'moving', 'lights', 'toggles', 'notes', 'type', 'variant', 'dims_m',
            'measured_m', 'variants_available', 'real_name', 'destroyed', 'handedness'}

def _r(x, n=4):
    if isinstance(x, float): return round(x, n)
    if isinstance(x, list): return [_r(v, n) for v in x]
    if isinstance(x, dict): return {k: _r(v, n) for k, v in x.items()}
    return x

def from_kit(d, group, asset):
    v = d['vehicle']
    socks = [s for s in v['sockets'] if not s['name'].startswith('muzzle')]
    muz = [dict(s, weapon=s.get('weapon')) for s in v['sockets'] if s['name'].startswith('muzzle')]
    extra = {k: val for k, val in v.items() if k not in KIT_SKIP}
    return _r({
        'model': d['asset'], 'asset': asset, 'group': group, 'type': v['type'], 'variant': v['variant'],
        'destroyed': bool(v['destroyed']), 'real_name': v.get('real_name'), 'coords': COORDS,
        'dims': v.get('dims_m'), 'measured': v.get('measured_m'), 'bbox': d.get('bbox_game'), 'height': d.get('height'),
        'footprints': d.get('footprints', []),
        'parts': v['moving'], 'sockets': socks, 'muzzles': muz, 'emitters': v['emitters'], 'lights': v['lights'],
        'contacts': v['contacts'], 'tracks': [], 'toggles': v.get('toggles') or {}, 'notes': v.get('notes') or [],
        'extra': extra,
    })

def _limits(n):
    if 'open_deg' in n: o = n['open_deg']; return [min(0, o), max(0, o)]
    if 'elev_min' in n: return [n['elev_min'], n['elev_max']]
    if 'steer_max_deg' in n: s = n['steer_max_deg']; return [-s, s]
    if isinstance(n.get('traverse_deg'), list): return n['traverse_deg']
    if isinstance(n.get('elev'), list): return n['elev']
    return None

def from_armour(d, asset, burnt):
    parts = []
    for n in d['nodes']:
        p = {'node': n['name'], 'kind': n['kind'], 'pivot': n['pivot'], 'axis': n.get('axis', [0, 1, 0]),
             'parent': n['parent']}
        lim = _limits(n)
        if lim: p['limits_deg'] = lim
        for k, val in n.items():
            if k not in ('name', 'kind', 'pivot', 'axis', 'parent', 'local'): p[k] = val
        parts.append(p)
    tv = {}
    for k, val in d['variants'].items():
        if k == 'burnt' and not burnt: continue
        if k != 'burnt' and burnt: continue
        tv[k] = {'theater': val.get('theater')} if isinstance(val, dict) else {}
    em = d['emitters']
    if burnt:   # a burnt-out hull has no running engine
        em = [e for e in em if e.get('kind') not in ('exhaust', 'dust', 'mud')] + \
             [{'kind': 'smoke', 'pos': [0, d['bbox_game']['max'][1], 0], 'dir': [0, 1, 0], 'node': None, 'note': 'wreck smoke'}]
    return _r({
        'model': asset + ('_burnt' if burnt else ''), 'asset': asset, 'group': 'armour', 'type': asset,
        'variant': 'burnt' if burnt else d.get('default_variant', 'grey'), 'destroyed': burnt,
        'real_name': (d.get('info') or {}).get('model') if isinstance(d.get('info'), dict) else None, 'coords': COORDS,
        'dims': d.get('dims_real'), 'measured': None, 'bbox': d.get('bbox_game'), 'height': (d.get('bbox_game') or {}).get('max', [0, 0])[1],
        'footprints': [], 'parts': parts, 'sockets': d['sockets'], 'muzzles': d['muzzles'], 'emitters': em,
        'lights': [] if burnt else d['lights'], 'contacts': [] if burnt else d['contacts'], 'tracks': d['tracks'],
        'toggles': {}, 'notes': [d.get('variant_note')] if d.get('variant_note') else [],
        'texture_variants': tv, 'texture_swap': "replace '_grey_' with '_<variant>_' in every texture URI",
        'extra': {'info': d.get('info'), 'markings': d.get('markings'), 'size': d.get('size')},
    })
