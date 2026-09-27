import json,struct,sys
b=open(sys.argv[1],'rb').read()
L=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+L])
res=[]
for n in j['nodes']:
    if 'mesh' not in n: continue
    m=j['meshes'][n['mesh']]
    for p in m['primitives']:
        acc=j['accessors'][p['attributes']['POSITION']]
        res.append((acc['min'][1], n.get('name'), n.get('translation')))
for r in sorted(res)[:6]: print(r)
