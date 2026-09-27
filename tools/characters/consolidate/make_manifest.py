# Builds assets/characters/manifest.json from the copied GLBs + sidecars (run after copy_assets.py / copy_runtime.py).
import json, os, struct, glob, time
A = os.path.join(os.path.dirname(__file__), '../../../assets/characters')
A = os.path.normpath(A)

def glb_json(p):
    b = open(p, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; return json.loads(b[20:20 + n])

def mesh_parts(p):
    j = glb_json(p); names = []
    for nd in j.get('nodes', []):
        if 'mesh' in nd: names.append(nd.get('name'))
    return names

def load(p):
    return json.load(open(p)) if os.path.exists(p) else {}

def size(p): return os.path.getsize(p)

LOD_RULE = {'LOD0': '>= 60 px/m', 'LOD1': '28-60 px/m', 'LOD2': '< 28 px/m',
            'note': 'px/m = CSS px per metre of the orthographic game camera (40 at zoom 1). Enemies: enemy_runtime.enemyLodFor.'}
RT = {
    'commandos_a': {'module': '../../src/art/characters/commandos_a/ca_runtime.js', 'create': 'createCommando + equipCA',
                    'anims': ['anims/base_anims.glb', 'anims/enemy_anims.glb (fill)', 'anims/guest_anims.glb (fill)', 'anims/ca_anims.glb (overlay wins)'],
                    'weapons': 'weapons/weapons.glb'},
    'commandos_b': {'module': '../../src/art/characters/commandos_b/charkit.js', 'create': 'createHumanoid({disguise}) + weapons.equip',
                    'anims': ['anims/commando_anims.glb', 'anims/enemy_anims.glb (fill)', 'anims/guest_anims.glb (fill)'],
                    'weapons': 'weapons/weapons_b.glb'},
    'enemies': {'module': '../../src/art/characters/commandos_b/squadkit.js (wraps ../../src/art/characters/enemies/enemykit.js)', 'create': 'spawnSquadMember',
                'anims': ['anims/base_anims.glb', 'anims/enemy_anims.glb (overlay wins)'], 'weapons': 'weapons/weapons.glb'},
    'guests': {'module': '../../src/art/characters/guests/guestkit.js', 'create': 'createGuest',
               'anims': ['anims/commando_anims.glb', 'anims/guest_anims.glb (overlay wins)'], 'weapons': 'weapons/weapons_b.glb'},
    'dogs': {'module': '../../src/art/characters/guests/dogkit.js', 'create': 'createDog', 'anims': ['embedded in each dog GLB'], 'weapons': None},
}
COMMANDO_RT = {'greenberet': 'commandos_a', 'sniper': 'commandos_a', 'marine': 'commandos_a', 'marine_diver': 'commandos_a',
               'sapper': 'commandos_b', 'driver': 'commandos_b', 'driver_burns': 'commandos_b', 'spy': 'commandos_b', 'spy_disguise': 'commandos_b'}
ROLES = {  # game role (Commando.role) -> character ids
    'greenberet': {'default': 'greenberet'}, 'sniper': {'default': 'sniper'},
    'diver': {'default': 'marine', 'water': 'marine_diver', 'swapWhen': 'marine -> marine_diver on swim/dive; back when leaving the water'},
    'sapper': {'default': 'sapper'},
    'driver': {'default': 'driver', 'burns': 'driver_burns', 'swapWhen': 'driver_burns from mission 8 on'},
    'spy': {'default': 'spy', 'disguise': 'spy_disguise', 'swapWhen': 'setDisguise(true) shows the officer uniform meshes (same skeleton)'},
}
chars = {}

def entry(cid, group, rel, side, **kw):
    p = os.path.join(A, rel)
    e = {'group': group, 'runtime': kw.pop('runtime', group), 'glb': rel, 'bytes': size(p), 'meshes': mesh_parts(p),
         'lods': ['LOD0', 'LOD1', 'LOD2'], 'sidecar': kw.pop('sidecar', rel[:-4] + '.sidecar.json')}
    e.update(kw); chars[cid] = e; return e

for cid, rt in COMMANDO_RT.items():
    sc = load(os.path.join(A, f'commandos/{cid}.sidecar.json'))
    hg = sc.get('headgear') or {}
    w = sc.get('weapons') or {}
    entry(cid, 'commandos', f'commandos/{cid}.glb', sc, runtime=rt, faction='player', role=sc.get('role'),
          name=sc.get('displayName') or sc.get('name'), key=sc.get('key'), heightM=sc.get('heightM') or sc.get('height_m'),
          tris=sc.get('lods') if 'LOD0' in (sc.get('lods') or {}) else sc.get('tris'),
          headgear=({'type': hg.get('type'), 'eyesClear': hg.get('eyes_clear'), 'frontEdgeAboveBrowM': hg.get('front_edge_above_brow_m')} if hg.get('type') else None),
          weapon={'primary': w.get('primary'), 'secondary': w.get('secondary')}, sockets=sc.get('sockets'))

idx = load(os.path.join(A, 'enemies/enemies_index.json'))
enemy_types = {}
for t, vs in idx.items():
    enemy_types[t] = []
    for v in vs:
        cid = v['id']; enemy_types[t].append(cid)
        sc = load(os.path.join(A, f'enemies/{cid}.json'))
        hg = sc.get('headgear') or {}
        entry(cid, 'enemies', f'enemies/{cid}.glb', sc, sidecar=f'enemies/{cid}.json', faction='enemy', soldierType=t,
              variant=sc.get('variant'), heightM=sc.get('heightM'), tris=sc.get('tris'), silhouette=sc.get('silhouette'),
              face={'head': v.get('head'), 'key': v.get('key'), 'tone': v.get('tone'), 'facialHair': v.get('facialHair'),
                    'glasses': v.get('glasses'), 'archetype': (sc.get('variety') or {}).get('archetype_name'), 'age': (sc.get('variety') or {}).get('age')},
              headgear=({'type': hg.get('type'), 'eyesClear': hg.get('eyes_clear'), 'frontEdgeAboveBrowM': hg.get('front_edge_above_brow_m')} if hg.get('type') else None),
              weapon={'primary': (sc.get('sockets') or {}).get('weapon')}, sockets=sc.get('sockets'))

for p in sorted(glob.glob(os.path.join(A, 'guests/*.glb'))):
    cid = os.path.basename(p)[:-4]; sc = load(p[:-4] + '.sidecar.json'); hg = sc.get('headgear') or {}
    entry(cid, 'guests', f'guests/{cid}.glb', sc, faction='neutral', role=sc.get('role') or 'guest', name=sc.get('name'),
          mission=sc.get('mission'), heightM=sc.get('height_m'), tris=sc.get('tris'), renderAs=sc.get('render_as'),
          rules=sc.get('guest_rules'), headgear=({'type': hg.get('type'), 'eyesClear': hg.get('eyes_clear')} if hg.get('type') else None),
          sockets=sc.get('sockets'))
for p in sorted(glob.glob(os.path.join(A, 'dogs/*.glb'))):
    cid = os.path.basename(p)[:-4]; sc = load(p[:-4] + '.sidecar.json')
    entry(cid, 'dogs', f'dogs/{cid}.glb', sc, runtime='dogs', faction='enemy', soldierType='dog', tris=sc.get('tris'),
          clips=sorted((sc.get('clips') or {}).keys()))

anims = {}
for n in ['base_anims', 'commando_anims', 'ca_anims', 'enemy_anims', 'guest_anims']:
    meta = load(os.path.join(A, f'anims/{n}.json'))
    anims[n] = {'glb': f'anims/{n}.glb', 'bytes': size(os.path.join(A, f'anims/{n}.glb')), 'meta': f'anims/{n}.json', 'clips': sorted(meta.keys())}

man = {
    'version': 1, 'generated': time.strftime('%Y-%m-%d'), 'base': 'assets/characters/',
    'skeleton': 'Quaternius Universal Animation Library rig (CC0); every body is MPFB 2.0.8 (CC0 MakeHuman assets) re-bound to it',
    'lodRule': LOD_RULE, 'runtimes': RT, 'roles': ROLES,
    'enemyTypes': enemy_types,
    'enemyAliases': {'soldier': 'rifleman', 'truckDriver': 'crew', 'courier': 'trooper', 'gunner': 'mg', 'tankcrew': 'crew', 'sniper': 'rifleman', 'tutorial': 'rifleman'},
    'theatres': {'desert': {'soldier': 'afrika', 'sentry': 'afrika', 'rifleman': 'afrika'}, 'winter': {'soldier': 'winter', 'sentry': 'winter', 'rifleman': 'winter'}},
    'seeds': {'variantPick': 'squadkit.assignSquadVariants(missionId, spawns, variantsByType): no repeated variant within 30 m / same squad, unique heads per squad; '
                             'fallback for a lone unit: fnv1a(missionId|seed) over the soldierType list',
              'instance': 'squadJitter(missionId, spawnId): height N(1.74,0.06) clamped 1.62-1.88, width 0.94-1.08, tunic/trouser tint batches, idle clip + phase'},
    'weapons': {'weapons/weapons.glb': 'kar98k mp40 mg34 mg42 luger walther_p38 colt1911 no4_sniper thompson knife harpoon_gun syringe time_bomb remote_bomb stick_grenade',
                'weapons/weapons_b.glb': 'same + cigarette, wire_cutters, mills_bomb (commandos_b props)',
                'sockets': ['grip_r', 'grip_l', 'butt', 'muzzle', 'sling_f', 'sling_b', 'tip', 'scope', 'bipod']},
    'animations': anims, 'characters': chars,
}
out = os.path.join(A, 'manifest.json')
json.dump(man, open(out, 'w'), indent=1)
print('characters', len(chars), 'enemy variants', sum(len(v) for v in enemy_types.values()), 'bytes', os.path.getsize(out))
