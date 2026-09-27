import json,sys
d=json.load(open(sys.argv[1]))
for id,o in d.items():
  print('==',id,'missing',o['missing'])
  for c in ['crawl','drag','crouch_walk','walk','run','sprint','carry_walk']:
    r=o['loco'].get(c)
    if not r: continue
    for k in ['atNative','atGame']:
      g=r.get(k)
      if not g: continue
      sl={e:(v['slide'],v['stanceFrac'],v['minY']) for e,v in g['slide'].items()}
      print(f" {c:11s} {k:8s} {g['clip']:11s} v{g['v']:.2f} ts{g['timeScale']} spm{g['stepsPerMin']}", sl)
  for c in ['stab','drag','crawl','crawl_idle','die_prone','dead_prone','crouch_walk','kneel_shoot','plant','dead']:
    x=o['clips'].get(c)
    if x: print(f"  clip {c:11s} minV {x['minVertY']} {x['lowBone']} pelvis {x['pelvisY']} jit {x['jitter']} seam {x['seam']}")
  for f,x in o['death'].items(): print('  death',f,x['clip'],'maxP',x['maxPelvisY'],'endMinV',x['endMinVertY'],'deadMinV',x['deadMinVertY'],'pop',x['dieToDeadPop'])
  for t,x in o['trans'].items():
    if 'crawl' in t: print('  trans',t,x)
  print('  carry drag',o['carry'].get('drag'))
