import json,sys
d=json.load(open(sys.argv[1]))
G={'mcrae','informer','gilbert','prisoner_farmhand','prisoner_worker','prisoner_oldman','prisoner_clerk','civ_tram_driver'}
for cid,o in d.items():
    if cid not in G: continue
    print('==',cid,'missing',o['missing'])
    for c,r in o['loco'].items():
        if 'mapped' in r: print('  loco',c,r['mapped']); continue
        for k in ('atNative','atGame'):
            if k in r:
                g=r[k]; sl=g['slide']; mx=max((v['slide'] for kk,v in sl.items() if not kk.startswith('calf') and v['slide'] is not None and v['slide']==v['slide']), default=-1); cf=max((v['slide'] for kk,v in sl.items() if kk.startswith('calf')), default=0)
                mny=min(v['minY'] for v in sl.values())
                print(f"  loco {c:15s} {k:8s} v={g['v']:.2f} spm={g['stepsPerMin']} slip={mx:.2f} minY={mny:.3f}" + (f' (knee joint, no contact: {cf:.2f})' if cf else ''))
    for c,r in o['clips'].items():
        if r['minVertY']< -0.01 or r['jitter']>0.12: print(f"  clip {c:14s} minVertY={r['minVertY']} low={r['lowBone']} jit={r['jitter']} seam={r['seam']}")
    for f,r in o['death'].items(): print(f"  death from {f:5s} maxPel={r['maxPelvisY']} endPel={r['endPelvisY']} endMin={r['endMinVertY']} {r['endLowBone']} deadMin={r['deadMinVertY']} pop={r['dieToDeadPop']}")
    for t,r in o['trans'].items(): print(f"  trans {t:18s} fade={r['fadeJump']} after={r['afterJump']} pdrop={r['pelvisDropPerFrame']}")
