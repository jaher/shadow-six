"""fixnames.py <glb...>: strip Blender '.NNN' suffixes from glTF node/mesh names in place (see veh._strip_suffix)."""
import sys, json, struct, re
def fix(p):
    b = open(p, 'rb').read()
    n = struct.unpack_from('<I', b, 12)[0]
    js = json.loads(b[20:20 + n]); rest = b[20 + n:]
    ch = 0
    for key in ('nodes', 'meshes'):
        L = js.get(key, []); taken = {x.get('name') for x in L}
        for x in L:
            nm = x.get('name', ''); bn = re.sub(r'\.\d{3}$', '', nm)
            if bn != nm and bn not in taken:
                taken.add(bn); x['name'] = bn; ch += 1
    if not ch:
        return 0
    j = json.dumps(js, separators=(',', ':')).encode()
    j += b' ' * ((4 - len(j) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(j) + len(rest)) + struct.pack('<II', len(j), 0x4E4F534A) + j + rest
    open(p, 'wb').write(out)
    return ch
for p in sys.argv[1:]:
    c = fix(p)
    if c: print(p.split('/')[-1], c)
