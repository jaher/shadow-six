import json,struct,sys,collections
for p in sys.argv[1:]:
    b=open(p,'rb').read(); ln=struct.unpack_from('<I',b,12)[0]; js=json.loads(b[20:20+ln])
    bv=js['bufferViews']; acc=js['accessors']; used=collections.Counter()
    img=sum(bv[i['bufferView']]['byteLength'] for i in js.get('images',[]) if 'bufferView' in i)
    for m in js['meshes']:
        for pr in m['primitives']:
            for k,a in pr['attributes'].items(): used[k]+=bv[acc[a]['bufferView']]['byteLength'] if 'bufferView' in acc[a] else 0
            if 'indices' in pr: used['IDX']+=bv[acc[pr['indices']]['bufferView']]['byteLength']
    print(p.split('/')[-1], 'img %dKB'%(img/1024), {k:'%dKB'%(v/1024) for k,v in used.items()}, 'meshes',len(js['meshes']))
