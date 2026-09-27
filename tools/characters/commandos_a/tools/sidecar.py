# sidecar.py - write out/<id>.sidecar.json for each commandos_a character from the build report + GLB + anims.json
# usage: python3 tools/sidecar.py greenberet sniper marine marine_diver
import json, os, sys, struct
HERE = os.path.dirname(os.path.abspath(__file__)); CA = os.path.dirname(HERE)
OUT = os.path.join(CA, 'out'); SHARED = os.path.join(CA, '..', 'out')
anims = json.load(open(os.path.join(SHARED, 'anims.json')))

ROLE = {
    'greenberet': dict(role='greenberet', key=1, name='Green Beret "Tiny"', primary='knife', secondary='colt1911',
                       clips_core=['stab', 'climb', 'carry_idle', 'carry_walk', 'carry_barrel', 'dig', 'bury', 'punch', 'use', 'shoot']),
    'sniper': dict(role='sniper', key=2, name='Sniper "Duke"', primary='no4_sniper', secondary='colt1911',
                   clips_core=['kneel_shoot', 'rifle_shoot', 'aim', 'reload', 'syringe', 'shoot']),
    'marine': dict(role='diver', key=3, name='Marine "Fins" (land)', primary='harpoon_gun', secondary='colt1911', variant_of=None,
                   swap_to='marine_diver', swap_when='enters deep water (swim/dive)',
                   clips_core=['rifle_shoot', 'aim', 'stab', 'throw', 'push', 'use', 'shoot']),
    'marine_diver': dict(role='diver', key=3, name='Marine "Fins" (diving gear)', primary='harpoon_gun', secondary=None, variant_of='marine',
                         swap_to='marine', swap_when='leaves the water', clips_core=['swim', 'swim_idle', 'dive', 'rifle_shoot', 'stab']),
}
COMMON = ['idle', 'walk', 'run', 'crouch_idle', 'crouch_walk', 'crawl', 'crawl_idle', 'die', 'dead', 'hit', 'surrender',
          'handsup_held', 'look_around', 'pickup', 'salute', 'wave', 'talk', 'drive', 'sit']


def glb_meshes(path):
    b = open(path, 'rb').read()
    ln = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + ln])
    return [n.get('name') for n in j.get('meshes', [])], len(j.get('materials', [])), [n.get('name') for n in j.get('nodes', []) if n.get('name')]


for cid in sys.argv[1:]:
    rep = json.load(open(os.path.join(OUT, cid + '.report.json')))
    glb = os.path.join(OUT, cid + '.glb')
    meshes, nmat, nodes = glb_meshes(glb)
    t = rep['tris']
    r = ROLE[cid]
    hg = rep.get('headgear_fit')
    lod0_total = t.get('LOD0', 0) + t.get('LOD0_alpha', 0) + t.get('headgear', 0)
    sc = {
        'id': cid, 'role': r['role'], 'key': r['key'], 'displayName': r['name'], 'glb': f'chars/commandos_a/out/{cid}.glb',
        'sizeBytes': os.path.getsize(glb), 'heightM': round(rep['height_m'], 3), 'materials': nmat,
        'lods': {'LOD0': lod0_total, 'LOD1': t.get('LOD1'), 'LOD2': t.get('LOD2'),
                 'LOD0_parts': {k: t[k] for k in ('LOD0', 'LOD0_alpha', 'headgear') if k in t}},
        'autoLOD_px_per_m': {'LOD0': '>= 60', 'LOD1': '25-60', 'LOD2': '< 25'},
        'parts': [n for n in nodes if n in ('LOD0', 'LOD0_alpha', 'LOD1', 'LOD2', 'headgear')],
        'headgear': hg if hg else {'type': None, 'note': 'bare head (bible 1.2) or hood (diver)'},
        'sockets': {
            'weapon_hand_r': 'hand_r', 'weapon_hand_l_ik': 'hand_l (two-bone IK to weapon grip_l)', 'sling': 'spine_03 (right shoulder)',
            'back': 'spine_03 (crawl/swim/carry)', 'head': 'head', 'pelvis': 'pelvis',
            'weapon_sockets': ['grip_r', 'grip_l', 'butt', 'muzzle', 'sling_f', 'sling_b', 'tip', 'scope', 'bipod']},
        'weapons': {'primary': r['primary'], 'secondary': r['secondary'], 'props': 'chars/out/weapons.glb'},
        'animations': {'library': 'chars/out/anims.glb', 'skeleton': 'Quaternius UAL (CC0)',
                       'core': r['clips_core'], 'common': COMMON,
                       'all_supported': sorted(anims.keys()),
                       'groundSpeed': {k: anims[k].get('groundSpeed') for k in ('walk', 'run', 'crawl', 'crouch_walk', 'swim') if k in anims}},
        'variant_of': r.get('variant_of'), 'swap_to': r.get('swap_to'), 'swap_when': r.get('swap_when'),
        'spec': f'chars/commandos_a/specs/{cid}.json',
        'build': {'wrapper': 'chars/commandos_a/blender/build_ca.py', 'seconds': rep.get('build_s')},
        'licence': 'MPFB/MakeHuman CC0 assets + project code CC0; UAL clips CC0',
    }
    json.dump(sc, open(os.path.join(OUT, cid + '.sidecar.json'), 'w'), indent=1)
    print(cid, sc['sizeBytes'], sc['lods']['LOD0'], sc['lods']['LOD1'], sc['lods']['LOD2'], 'mats', nmat, 'hg', (hg or {}).get('type'), (hg or {}).get('eyes_clear'))
