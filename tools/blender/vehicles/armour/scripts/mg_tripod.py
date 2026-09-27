# mg_tripod.py - MG 34 or MG 42 on the MG-Lafette 34 (sMG role), low (prone) position, 2 Patronenkasten 34.
# MG 34: 1.22 m, tubular receiver, round-perforated jacket, cone booster; MG 42: 1.22 m, stamped receiver, square
# jacket with oval slots + the large right-side barrel-change slot. Lafette 34 details: see mgkit.py.
# Run: blender ... --python mg_tripod.py -- mg34|mg42 [preview]
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vlib as V
from vlib import B, P, node
import mgkit as M
V.DUST_SCALE = 0.45
V.LOD_RATIO = {0: 1.0, 1: 0.6, 2: 0.5}          # small asset: keep LOD2 readable (~15 % of LOD0 after lod culling)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
KIND = argv[0] if argv and argv[0] in ('mg34', 'mg42') else 'mg42'
V.begin(f'{KIND}_tripod', seed=34 if KIND == 'mg34' else 42)
gz = M.tripod(KIND, (0, 0, 0), 'hull', low=True)
V.emitter('muzzle_dust', (0, -0.9, 0.02), 'hull', (0, -1, 0.2), 'blast_dust')
V.emitter('case_eject', (0.0, 0.1, gz - 0.05), 'gun', (0, 0, -1), 'casings')
if 'preview' in argv:
    B.preview(os.path.join(V.A.out, 'model_eevee.png'), target=(0, 0, 0.3), dist=3.2, elev=30, azim=-40, lens=50)
    sys.exit(0)
V.finalize(1024, dims=dict(gun_length=1.22, bore_height=round(gz, 3), footprint=[1.1, 1.0]),
           burnt_pose={'mount': dict(rot=(0, 0, 35)), 'gun': dict(rot=(12, 25, 0)), 'hull': dict(rot=(0, 18, 0), off=(0, 0, -0.02))},
           burnt_drop=('ammo_lid', 'ammo_handle', 'sight_', 'belt', 'carry_pad', 'elev_wheel', 'elev_crank'),
           info=dict(model=f'{KIND.upper()} on MG-Lafette 34 (low position) with MG-Zieleinrichtung 34', crew=2, role='heavy machine-gun position',
                     sources='vehicles/refs/armour/urls.json'))
