# tools_sidecar.py - write out/<id>.sidecar.json for every guest/civilian human (+ copy the spec) from the build report.
import json, os, glob
G = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(G, 'out')
anims = json.load(open(os.path.join(G, '..', 'out', 'anims.json')))
gan = json.load(open(os.path.join(OUT, 'guest_anims.json')))
NAMES = {'mcrae': ('guest', 'Capt. Gregor McRae, RAF pilot'), 'informer': ('guest', 'The Informer'), 'gilbert': ('guest', 'Claude Gilbert'),
         'prisoner_farmhand': ('guest', 'M17 prisoner: young farmhand'), 'prisoner_worker': ('guest', 'M17 prisoner: worker'),
         'prisoner_oldman': ('guest', 'M17 prisoner: older man'), 'prisoner_clerk': ('guest', 'M17 prisoner: clerk'),
         'colonel_bust': ('briefing', 'Colonel Montague Smith (silhouette only)'), 'civ_tram_driver': ('civilian', 'M15 tram driver')}
for rep in sorted(glob.glob(os.path.join(OUT, '*.report.json'))):
    r = json.load(open(rep)); cid = r['id']
    if cid not in NAMES:
        continue
    spec = r['spec']; t = r['tris']
    role, name = NAMES[cid]
    g = spec.get('guest', {})
    base = sorted(k for k in anims if k != 'crawl' or g.get('can_crawl', True))
    if not g.get('can_crawl', True):
        base = [k for k in base if not k.startswith('crawl')]
    sc = {'id': cid, 'role': role, 'key': 7 if role == 'guest' else None, 'name': name,
          'mission': g.get('mission') or spec.get('civilian', {}).get('mission'), 'group': g.get('group'),
          'glb': cid + '.glb', 'bytes': os.path.getsize(os.path.join(OUT, cid + '.glb')), 'height_m': round(r['height_m'], 3),
          'skeleton': 'Quaternius UAL (rebound; share ../out/anims.glb + guest_anims.glb)', 'materials': 2,
          'tris': {'LOD0_total': t.get('LOD0', 0) + t.get('headgear', 0) + t.get('LOD0_alpha', 0), 'headgear': t.get('headgear', 0), 'LOD0': t.get('LOD0'),
                   'LOD0_alpha': t.get('LOD0_alpha'), 'LOD1': t.get('LOD1'), 'LOD2': t.get('LOD2')},
          'lod_rule': 'LOD0 >= 60 px/m, LOD1 >= 28 px/m, else LOD2 (charkit.lodFor)',
          'parts': ['LOD0', 'LOD0_alpha', 'LOD1', 'LOD2'] + (['headgear'] if t.get('headgear') else []),
          'headgear': r['headgear_fit'], 'sockets': {'right_hand': 'hand_r', 'left_hand': 'hand_l', 'head': 'Head', 'wrists_tied': 'hand_l+hand_r (tied_* clips)'},
          'weapons': None, 'kit': spec.get('kit', []), 'outfit': spec['outfit'],
          'animations_supported': base + sorted(gan.keys()),
          'guest_rules': {'unarmed': True, 'can_crawl': g.get('can_crawl', True), 'tied_hands_until_freed': g.get('tied_hands_until_freed', False),
                          'clips_while_tied': {'idle': 'tied_idle', 'walk': 'tied_walk', 'on_freed': 'freed'}} if role == 'guest' else None,
          'render_as': 'silhouette' if cid == 'colonel_bust' else 'normal',
          'spec': cid + '.spec.json', 'licence': 'MPFB/MakeHuman CC0 assets + project code (CC0); UAL clips CC0'}
    if cid == 'colonel_bust':
        sc['notes'] = 'Bible 6.4: never show his face. Render only as an unlit dark silhouette with a rim light behind the briefing slides (see review/colonel_silhouette).'
    json.dump(sc, open(os.path.join(OUT, cid + '.sidecar.json'), 'w'), indent=1)
    json.dump(spec, open(os.path.join(OUT, cid + '.spec.json'), 'w'), indent=1)
    print(cid, sc['tris']['LOD0_total'], sc['bytes'])
