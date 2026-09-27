import json,struct,sys
def mats(p):
    f=open(p,'rb').read();jl=struct.unpack('<I',f[12:16])[0];J=json.loads(f[20:20+jl])
    out={}
    for m in J['meshes']:
        for pr in m['primitives']:
            n=J['accessors'][pr['indices']]['count']//3
            k=J['materials'][pr['material']]['name']; out[k]=out.get(k,0)+n
    return out
for v in sys.argv[1:]:
    a=mats(f'{v}/{v}.glb'); b=mats(f'{v}/{v}_lod1.glb'); c=mats(f'{v}/{v}_lod2.glb')
    bad=[k for k in a if a[k]>300 and c.get(k,0) < 0.03*a[k]]
    print(v, 'LOD0 %d LOD1 %.1f%% LOD2 %.1f%%'%(sum(a.values()),100*sum(b.values())/sum(a.values()),100*sum(c.values())/sum(a.values())), 'SUSPECT:' if bad else 'ok', [(k[4:22],a[k],c.get(k,0)) for k in bad])
