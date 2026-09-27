#!/usr/bin/env python3
"""sidecar.py <out_dir> - per-character sidecar <id>.json + enemies_index.json (variantsByType for web/variety.js assignVariants)
Sidecar: identity/variety key, file size, tris per LOD, materials, sockets, headgear fit, supported animations per role."""
import json, os, sys, struct, glob

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'out')
PIPE_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'out')
BASE = list(json.load(open(os.path.join(PIPE_OUT, 'anims.json'))))
EXTRA = list(json.load(open(os.path.join(OUT, 'enemy_anims.json'))))
COMMON = ['idle', 'walk', 'run', 'sprint', 'look_around', 'aim', 'shoot', 'rifle_shoot', 'reload', 'hit', 'hit_head', 'knockback', 'die', 'dead',
          'surrender', 'handsup_held', 'talk', 'yes', 'no', 'fold_arms', 'crouch_idle', 'crouch_walk', 'kneel_shoot', 'punch', 'use', 'open',
          'sit', 'sit_enter', 'sit_exit', 'drive', 'salute', 'wave', 'point', 'stand_up', 'phone', 'climb']
ROLE = {
    'rifleman': ['smoke'], 'trooper': [], 'sentry': ['smoke'], 'sergeant': ['binoculars', 'pistol_idle'], 'officer': ['binoculars', 'pistol_idle', 'walk_formal'],
    'mg': [], 'engineer': ['detonate', 'dig', 'plant', 'carry_barrel', 'push'], 'crew': ['pistol_idle'], 'afrika': ['smoke'], 'winter': ['smoke'],
    'general': ['walk_hands_back', 'idle_hands_back', 'walk_formal'],
}
HOLD = {'kar98k': 'aim/lowready/sling (two-hand, left-hand IK to grip_l)', 'mp40': 'aim/lowready/sling', 'mg34': 'aim (hip) / back when crawling',
        'luger': 'hand (pistol)', 'walther_p38': 'hand (pistol)', None: 'unarmed'}


def glb_info(p):
    b = open(p, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    return j, len(b)


rows = []
index = {}
for rp in sorted(glob.glob(os.path.join(OUT, '*.report.json'))):
    rep = json.load(open(rp)); cid = rep['id']; spec = rep['spec']; e = spec.get('enemy', {})
    g = os.path.join(OUT, cid + '.glb')
    if not os.path.exists(g):
        continue
    j, size = glb_info(g)
    t = rep['tris']; st = e.get('soldierType', '?')
    lod0 = t.get('LOD0', 0) + t.get('headgear', 0) + t.get('LOD0_alpha', 0)
    weapon = (spec.get('weapon') or {}).get('primary')
    clips = [c for c in COMMON if c in BASE] + [c for c in ROLE.get(st, []) if c in BASE or c in EXTRA]
    sc = {
        'id': cid, 'glb': os.path.basename(g), 'bytes': size, 'soldierType': st, 'variant': e.get('variant'),
        'variety': {k: e.get(k) for k in ('archetype', 'archetype_name', 'skinTone', 'facialHair', 'glasses', 'age', 'key', 'extras')},
        'silhouette': e.get('silhouette'), 'heightM': round(rep['height_m'], 3),
        'tris': {'lod0_total': lod0, 'LOD0': t.get('LOD0'), 'headgear': t.get('headgear', 0), 'brows_alpha': t.get('LOD0_alpha', 0), 'LOD1': t.get('LOD1'), 'LOD2': t.get('LOD2')},
        'materials': len(j.get('materials', [])), 'textures': len(j.get('images', [])),
        'meshes': [m.get('name') for m in j.get('meshes', [])],
        'sockets': {'weapon_grip_r': 'hand_r', 'weapon_support_l': 'hand_l (two-bone IK to weapon grip_l)', 'sling': 'spine_03 / clavicle_r',
                    'back': 'spine_03', 'headgear': 'head (mesh "headgear", hideable)', 'beltZ': rep['measure']['belt_z'],
                    'weapon': weapon, 'hold': HOLD.get(weapon, 'hand'), 'weapon_sockets': ['grip_r', 'grip_l', 'butt', 'muzzle', 'sling_f', 'sling_b', 'bipod']},
        'headgear': rep.get('headgear_fit'),
        'animations': {'library': ['chars/out/anims.glb', 'chars/enemies/out/enemy_anims.glb'], 'supported': clips,
                       'speedScale': {'walk': e.get('walkSpeedScale', 1.0)}},
        'kit': spec.get('kit'), 'outfit': spec.get('outfit'), 'build_s': rep.get('build_s'),
        'licence': 'CC0: MakeHuman/MPFB system assets (CC0), Quaternius UAL (CC0), ambientCG (CC0); project geometry/code CC0',
    }
    json.dump(sc, open(os.path.join(OUT, cid + '.json'), 'w'), indent=1)
    index.setdefault(st, []).append({'id': cid, 'url': 'enemies/out/' + cid + '.glb', 'head': e.get('archetype'), 'key': e.get('key'),
                                     'tone': e.get('skinTone'), 'facialHair': e.get('facialHair'), 'glasses': e.get('glasses')})
    rows.append((cid, lod0, t.get('LOD1'), t.get('LOD2'), size, len(j.get('materials', [])), (rep.get('headgear_fit') or {}).get('eyes_clear')))
json.dump(index, open(os.path.join(OUT, 'enemies_index.json'), 'w'), indent=1)
for r in rows:
    print(f'{r[0]:18s} lod0 {r[1]:6d} lod1 {r[2]} lod2 {r[3]} {r[4] / 1e6:.2f} MB mats {r[5]} eyes_clear {r[6]}')
print(len(rows), 'characters; max lod0', max(r[1] for r in rows), 'max MB', round(max(r[4] for r in rows) / 1e6, 2), 'all eyes clear', all(r[6] in (True, None) for r in rows))
