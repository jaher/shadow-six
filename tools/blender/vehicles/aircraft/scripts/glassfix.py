"""glassfix.py <glb>...: re-apply ac.canopy_glass() to built GLBs without Blender (function source exec'd from ac.py)."""
import sys, os, re, types
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ac.py')).read()
fn = re.search(r'\ndef canopy_glass\(p\):.*?(?=\n\n\n)', src, re.S).group(0)
VH = types.SimpleNamespace(SCR=os.path.dirname(os.path.abspath(__file__)))
g = {'sys': sys, 'os': os, 'VH': VH}
exec(fn, g)
for p in sys.argv[1:]:
    g['canopy_glass'](p)
    print('glass', os.path.basename(p))
