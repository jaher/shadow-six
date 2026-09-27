import json,sys
d=json.load(open(sys.argv[1]))
for cid,o in d.items():
  print('=====',cid,'ratio',o['ratio'],'missing',o['missing'],'lift',o.get('groundLift'))
  for c,r in o['loco'].items():
    s='%-11s nat %.2f'%(c,r['native'])
    for k in ['atNative','atGame']:
      if k in r: x=r[k]; s+=' | %s v%.2f spm %d slip %s'%(k[2:],x['v'],x['stepsPerMin'] or 0,' '.join('%s:%.2f/%.2f/%.3f'%(e[:6],q['slide'],q['fwd'],q['minY']) for e,q in x['slide'].items()))
    print(s)
  for c in ['kneel_shoot','drag','dead','die','die_prone','dead_prone','crawl','crawl_idle','walk','run','idle','aim']:
    x=o['clips'].get(c)
    if x: print('  %-11s minV %.3f %-10s pelvisY %s jit %.3f seam %s'%(c,x['minVertY'],x['lowBone'],x['pelvisY'],x['jitter'],x['seam']))
  for c,a in o['aim'].items(): print('  aim',c,'flow',a['flow'],'\n      res',a['resolved'])
  for c,a in o['death'].items(): print('  death',c,{k:a[k] for k in ['maxPelvisY','startPelvisY','endPelvisY','endMinVertY','endLowBone','pelvisTravel','dieToDeadPop','deadMinVertY']})
