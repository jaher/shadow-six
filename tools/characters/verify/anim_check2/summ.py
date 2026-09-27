import json,sys
d=json.load(open(sys.argv[1]))
for cid,o in d.items():
  print('==',cid,'missing',o['missing'])
  low=sorted([(v['minVertY'],c,v['lowBone']) for c,v in o['clips'].items()])[:4]
  print(' low',low, ' jitter>0.15:',[(c,v['jitter']) for c,v in o['clips'].items() if v['jitter']>0.15], ' seam>0.05:',[(c,v['seam']) for c,v in o['clips'].items() if v['seam'] and v['seam']>0.05])
  for c,r in o['loco'].items():
    for k in ('atGame','atGame2'):
      if k in r:
        g=r[k]; sl={e:(x['slide'],x['minY']) for e,x in g['slide'].items()}
        print('  %-12s %-7s clip=%-12s v=%.2f spm=%d ts=%.2f'%(c,k,g.get('clip'),g['v'],g['stepsPerMin'],g['timeScale']), sl)
  for c,a in o['aim'].items(): print('  aim',c,a.get('clip'),a['later'] or a['flow'])
  for f,x in o['death'].items(): print('  death',f,x['clip'],'maxP',x['maxPelvisY'],'endMin',x['endMinVertY'],'pop',x['dieToDeadPop'],'deadMin',x['deadMinVertY'],'trav',x['pelvisTravel'])
  print('  trans',{k:v['fadeJump'] for k,v in o['trans'].items() if v['fadeJump']>0.12})
  if o['carry']: print('  carry',{k:(v['handL'],v['handR']) for k,v in o['carry'].items()})
