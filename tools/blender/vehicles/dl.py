import json, urllib.request, os, zipfile, io, sys
from concurrent.futures import ThreadPoolExecutor
UA={'User-Agent':'Mozilla/5.0 (asset-eval)'}
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=120).read()
manifest=[]
def ph(name,res='1k'):
    d=json.loads(get(f'https://api.polyhaven.com/files/{name}'))
    info=json.loads(get(f'https://api.polyhaven.com/info/{name}'))
    os.makedirs(f'tex/{name}',exist_ok=True)
    out={}
    for key,fn in [('Diffuse','diff'),('nor_gl','nor'),('arm','arm'),('Rough','rough'),('Displacement','disp')]:
        if key in d and res in d[key]:
            u=d[key][res]['jpg']['url'] if 'jpg' in d[key][res] else d[key][res]['png']['url']
            p=f'tex/{name}/{fn}.{u.rsplit(".",1)[1]}'
            if not os.path.exists(p): open(p,'wb').write(get(u))
            out[fn]=(p,u)
    manifest.append(dict(id=name,source='Poly Haven',page=f'https://polyhaven.com/a/{name}',license='CC0 1.0',authors=list(info.get('authors',{}).keys()),files={k:v[1] for k,v in out.items()}))
def acg(name,res='1K'):
    url=f'https://ambientcg.com/get?file={name}_{res}-JPG.zip'
    os.makedirs(f'tex/{name}',exist_ok=True)
    z=zipfile.ZipFile(io.BytesIO(get(url)))
    m={'Color':'diff','NormalGL':'nor','Roughness':'rough','AmbientOcclusion':'ao','Displacement':'disp','Metalness':'metal','Opacity':'alpha'}
    files={}
    for n in z.namelist():
        for k,v in m.items():
            if n.endswith(f'_{k}.jpg') or n.endswith(f'_{k}.png'):
                p=f'tex/{name}/{v}.jpg'; open(p,'wb').write(z.read(n)); files[v]=n
    manifest.append(dict(id=name,source='ambientCG',page=f'https://ambientcg.com/view?id={name}',license='CC0 1.0',download=url,files=files))
def hdri(name,res):
    u=f'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/{res}/{name}_{res}.hdr'
    p=f'hdri/{name}_{res}.hdr'
    if not os.path.exists(p): open(p,'wb').write(get(u))
    manifest.append(dict(id=name,source='Poly Haven HDRI',page=f'https://polyhaven.com/a/{name}',license='CC0 1.0',download=u))
jobs=[(ph,n) for n in 'white_rough_plaster rough_plaster_broken painted_plaster_wall weathered_peeling_timber weathered_plank_siding dark_planks wood_planks_grey weathered_planks green_metal_rust rust_coarse_01 sand_01 dense_sand pine_bark worn_corrugated_iron'.split()]
jobs+=[(acg,n) for n in ['Rubber004','Fabric030','Fabric045']]
def run(j):
    try: j[0](j[1]); print('ok',j[1])
    except Exception as e: print('FAIL',j[1],e)
with ThreadPoolExecutor(8) as ex: list(ex.map(run,jobs))
for n,r in [('goegap','1k'),('goegap','2k'),('kloofendal_43d_clear_puresky','1k'),('kloofendal_43d_clear_puresky','2k')]:
    try: hdri(n,r); print('ok',n,r)
    except Exception as e: print('FAIL',n,e)
json.dump(manifest,open('asset_manifest.json','w'),indent=1)
