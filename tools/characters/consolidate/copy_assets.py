# copy character assets from scratchpad/chars into the project (idempotent)
import os, shutil, glob, json
S = '<claude-tmp>'
P = '<repo>/assets/characters'
def cp(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst)
n = 0
# commandos
for cid in ['greenberet', 'sniper', 'marine', 'marine_diver']:
    for ext in ['.glb', '.sidecar.json']: cp(f'{S}/commandos_a/out/{cid}{ext}', f'{P}/commandos/{cid}{ext}'); n += 1
for cid in ['sapper', 'driver', 'driver_burns', 'spy', 'spy_disguise']:
    for ext in ['.glb', '.sidecar.json', '.spec.json']: cp(f'{S}/commandos_b/final/{cid}{ext}', f'{P}/commandos/{cid}{ext}'); n += 1
for cid in ['greenberet', 'sniper', 'marine', 'marine_diver']:
    cp(f'{S}/commandos_a/specs/{cid}.json', f'{P}/commandos/{cid}.spec.json'); n += 1
# enemies
idx = json.load(open(f'{S}/enemies/out/enemies_index.json'))
cp(f'{S}/enemies/out/enemies_index.json', f'{P}/enemies/enemies_index.json')
for t, vs in idx.items():
    for v in vs:
        for ext in ['.glb', '.json']: cp(f"{S}/enemies/out/{v['id']}{ext}", f"{P}/enemies/{v['id']}{ext}"); n += 1
# guests + dogs
for f in glob.glob(f'{S}/guests/out/*.glb'):
    b = os.path.basename(f)[:-4]
    if b == 'guest_anims': continue
    for ext in ['.glb', '.sidecar.json', '.spec.json']:
        if os.path.exists(f'{S}/guests/out/{b}{ext}'): cp(f'{S}/guests/out/{b}{ext}', f'{P}/guests/{b}{ext}'); n += 1
for f in glob.glob(f'{S}/guests/out/dogs/*.glb') + glob.glob(f'{S}/guests/out/dogs/*.sidecar.json'):
    cp(f, f'{P}/dogs/' + os.path.basename(f)); n += 1
# animation libraries
for src, dst in [('out/anims', 'base_anims'), ('commandos_b/out/anims', 'commando_anims'), ('commandos_a/out/ca_anims', 'ca_anims'),
                 ('enemies/out/enemy_anims', 'enemy_anims'), ('guests/out/guest_anims', 'guest_anims')]:
    for ext in ['.glb', '.json']: cp(f'{S}/{src}{ext}', f'{P}/anims/{dst}{ext}'); n += 1
# weapons + shared weapon atlases
cp(f'{S}/out/weapons.glb', f'{P}/weapons/weapons.glb'); cp(f'{S}/commandos_b/out/weapons/weapons.glb', f'{P}/weapons/weapons_b.glb'); n += 2
for m in ['albedo', 'normal', 'orm']:
    cp(f'{S}/out/weapons_{m}.jpg', f'{P}/tex/weapons_{m}.jpg'); cp(f'{S}/commandos_b/out/weapons/weapons_{m}.jpg', f'{P}/tex/weapons_b_{m}.jpg'); n += 2
print('copied', n)
