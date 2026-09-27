# tools_sidecar.py - write out/<id>.sidecar.json for every guest/civilian human (+ copy the spec) from the build report.
import json, os, glob
G = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(G, 'out')
anims = json.load(open(os.path.join(G, '..', 'commandos_b', 'out', 'anims.json')))   # rework lib (guests r1)
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
    crawl_ok = g.get('can_crawl', True)
    base = sorted(k for k in anims if crawl_ok or not (k.startswith('crawl') or k == 'die_prone'))
    gk = sorted(k for k in gan if crawl_ok or not (k.startswith('crawl') or k in ('go_prone', 'get_up')))
    sc = {'id': cid, 'role': role, 'key': 7 if role == 'guest' else None, 'name': name,
          'mission': g.get('mission') or spec.get('civilian', {}).get('mission'), 'group': g.get('group'),
          'glb': cid + '.glb', 'bytes': os.path.getsize(os.path.join(OUT, cid + '.glb')), 'height_m': round(r['height_m'], 3),
          'skeleton': 'Quaternius UAL (rebound; ../commandos_b/out/anims.glb + guest_anims.glb overlay)',
          'runtime': 'pipeline/web/guestkit.js: loadGuestLib() + createGuest(tpl, lib, {id}) (wraps charkit.createHumanoid)', 'materials': 2,
          'tris': {'LOD0_total': t.get('LOD0', 0) + t.get('headgear', 0) + t.get('LOD0_alpha', 0), 'headgear': t.get('headgear', 0), 'LOD0': t.get('LOD0'),
                   'LOD0_alpha': t.get('LOD0_alpha'), 'LOD1': t.get('LOD1'), 'LOD2': t.get('LOD2')},
          'lod_rule': 'LOD0 >= 60 px/m, LOD1 >= 28 px/m, else LOD2 (charkit.lodFor)',
          'parts': ['LOD0', 'LOD0_alpha', 'LOD1', 'LOD2'] + (['headgear'] if t.get('headgear') else []),
          'headgear': r['headgear_fit'], 'sockets': {'right_hand': 'hand_r', 'left_hand': 'hand_l', 'head': 'Head', 'wrists_tied': 'hand_l+hand_r (tied_* clips)'},
          'weapons': None, 'kit': spec.get('kit', []), 'outfit': spec['outfit'],
          'animations_supported': sorted(set(base + gk)),
          'guest_rules': {'unarmed': True, 'can_crawl': g.get('can_crawl', True), 'tied_hands_until_freed': g.get('tied_hands_until_freed', False),
                          'clips_while_tied': {'idle': 'tied_idle', 'walk': 'tied_walk (speed > 1.45 -> tied_walk_fast)', 'run': 'tied_walk capped 2.3 m/s', 'on_freed': 'freed'},
                          'clips_while_following': {'idle': 'follow_idle', 'walk': 'follow_walk'} if g.get('group') == 'm17_prisoners' or cid == 'gilbert' else None,
                          'crawl_orders': 'crawl/crawl_idle (go_prone / get_up transitions)' if crawl_ok else 'mapped to crouch_walk / crouch_idle (spec 3.5: M17 prisoners cannot crawl)',
                          'death': 'die (standing), die_run_* when running (forward fall, root moves 1.3 m -> dead_prone), die_prone when crawling',
                          'boarding': {'board_boat': 'raft -> boat_sit', 'board_truck': 'truck bed -> idle (then sit_enter/sit + sitOn)', 'board_car': 'Kubelwagen side -> sit (+ sitOn(seat,{floorY}))',
                                       'contract': 'clip meta.travel/travelYaw/next: guestkit moves/turns the root when the clip ends and plays next with no fade'}} if role == 'guest' else None,
          'render_as': 'silhouette' if cid == 'colonel_bust' else 'normal',
          'spec': cid + '.spec.json', 'licence': 'MPFB/MakeHuman CC0 assets + project code (CC0); UAL clips CC0'}
    if cid == 'colonel_bust':
        sc['notes'] = 'Bible 6.4: never show his face. Render only as an unlit dark silhouette with a rim light behind the briefing slides (see review/colonel_silhouette).'
    json.dump(sc, open(os.path.join(OUT, cid + '.sidecar.json'), 'w'), indent=1)
    json.dump(spec, open(os.path.join(OUT, cid + '.spec.json'), 'w'), indent=1)
    print(cid, sc['tris']['LOD0_total'], sc['bytes'])
