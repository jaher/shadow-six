import json,sys
d=json.load(open(sys.argv[1]))
for k,x in d.items():
  print('==',k,'missing',x['missing'])
  for c,r in x['loco'].items():
    print(' ',c,'native',r['native'], {kk:(v.get('clip'),v['v'],v['timeScale'],v['stepsPerMin'],{e:(s['slide'],s['minY']) for e,s in v['slide'].items()}) for kk,v in r.items() if kk!='native'})
  print(' death', {k2:(v['maxPelvisY'],v['endPelvisY'],v['endMinVertY'],v['endLowBone'],v['deadMinVertY']) for k2,v in x['death'].items()})
  for c,v in x['aim'].items(): print(' aim',c,v['flow'],'|',v['resolved'])
  bad=[(c,v['minVertY'],v['lowBone']) for c,v in x['clips'].items() if v['minVertY']<-0.02 and c not in('swim','dive')]
  print(' under-ground clips:',bad)
  for c in ['drive','sit','plant','kneel_shoot','dead','dead_prone','set_trap','cut_wire','carried']:
    if c in x['clips']: print('  clip',c,x['clips'][c]['minVertY'],x['clips'][c]['lowBone'],x['clips'][c]['pelvisY'])
