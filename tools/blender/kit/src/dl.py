import json, os, sys, urllib.request, zipfile, io, time
ROOT=os.path.dirname(os.path.abspath(__file__)); RAW=os.path.join(ROOT,'raw'); os.makedirs(RAW,exist_ok=True)
src=json.load(open(os.path.join(ROOT,'sources.json')))
def get(url):
    for i in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 shadow-six-kit'})
            return urllib.request.urlopen(req,timeout=60).read()
        except Exception as e: print('retry',url,e,flush=True); time.sleep(2)
    raise RuntimeError(url)
import concurrent.futures as cf
credits={}
def one(mid,s):
    d=os.path.join(RAW,mid); os.makedirs(d,exist_ok=True)
    if 'ph' in s:
        pid=s['ph']; info=json.loads(get(f'https://api.polyhaven.com/info/{pid}')); files=json.loads(get(f'https://api.polyhaven.com/files/{pid}'))
        want={'diff':'Diffuse','nor':'nor_gl','rough':'Rough','ao':'AO','arm':'arm'}
        for k,key in want.items():
            if key not in files: continue
            fp=os.path.join(d,k+'.jpg')
            if not os.path.exists(fp): open(fp,'wb').write(get(files[key]['2k']['jpg']['url']))
        dims=info.get('dimensions',[2000,2000])
        credits[mid]={'source':'Poly Haven','id':pid,'url':f'https://polyhaven.com/a/{pid}','authors':list(info.get('authors',{}).keys()),'license':'CC0-1.0','dimensions_mm':dims,'name':info.get('name')}
    else:
        aid=s['acg']; z=zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={aid}_2K-JPG.zip')))
        m={'_Color':'diff','_NormalGL':'nor','_Roughness':'rough','_AmbientOcclusion':'ao'}
        for n in z.namelist():
            for suf,k in m.items():
                if suf in n and n.endswith('.jpg'): open(os.path.join(d,k+'.jpg'),'wb').write(z.read(n))
        meta=json.loads(get(f'https://ambientcg.com/api/v2/full_json?id={aid}&include=dimensionsData'))['foundAssets'][0]
        credits[mid]={'source':'ambientCG','id':aid,'url':f'https://ambientcg.com/view?id={aid}','authors':['ambientCG (Lennart Demes)'],'license':'CC0-1.0','dimensions_mm':[meta.get('dimensionX',100)*10,meta.get('dimensionY',100)*10]}
    print('ok',mid,sorted(os.listdir(d)),flush=True)
with cf.ThreadPoolExecutor(8) as ex:
    fs=[ex.submit(one,m,s) for m,s in src.items()]
    for f in fs:
        try: f.result()
        except Exception as e: print('FAIL',e,flush=True)
json.dump(credits,open(os.path.join(ROOT,'credits_raw.json'),'w'),indent=1)
print('DONE')
