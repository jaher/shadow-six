# shoot.py - run registered icon shots.  blender -b --factory-startup -P shoot.py -- <module> <name[,name]|all> [mode=item]
import sys, os, importlib, traceback
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.join(HERE, 'models')]
import studio as S
a = S.argv(); mod = importlib.import_module(a[0])
names = [k for k, f in S.REG.items() if f.__module__ == a[0]] if len(a) < 2 or a[1] == 'all' else a[1].split(',')
mode = a[2] if len(a) > 2 else 'item'
for n in names:
    try:
        S.reset(); S.REG[n](mode)
    except Exception:
        traceback.print_exc(); print('FAILED', n)
