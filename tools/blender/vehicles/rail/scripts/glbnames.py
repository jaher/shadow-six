"""glbnames.py - strip Blender '.001' suffixes from glTF node names (LOD1/LOD2 are built while the LOD0 objects still
exist, so Blender renames them). Mesh nodes win the base name; empties (sockets) keep theirs.
CLI: python3 glbnames.py out/*/*.glb   (uses the sidecar node list)"""
import json, struct, re, sys, os, glob


def read(p):
    b = open(p, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    js = json.loads(b[20:20 + n])
    rest = b[20 + n:]
    return js, rest


def write(p, js, rest):
    j = json.dumps(js, separators=(',', ':')).encode()
    j += b' ' * ((4 - len(j) % 4) % 4)
    total = 12 + 8 + len(j) + len(rest)
    open(p, 'wb').write(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(j), 0x4E4F534A) + j + rest)


def fix(p, nodeset):
    js, rest = read(p)
    names = [n.get('name', '') for n in js['nodes']]
    taken = set(names)
    changed = 0
    for pref_mesh in (True, False):
        for n in js['nodes']:
            nm = n.get('name', '')
            base = re.sub(r'\.\d{3}$', '', nm)
            if base == nm or base not in nodeset or ('mesh' in n) != pref_mesh:
                continue
            if base in taken:
                continue
            taken.discard(nm)
            taken.add(base)
            n['name'] = base
            changed += 1
    if changed:
        write(p, js, rest)
    return changed


if __name__ == '__main__':
    for p in sys.argv[1:]:
        side = re.sub(r'(_lod\d)?\.glb$', '.kit.json', p)
        ns = set(json.load(open(side))['nodes']) | {'main'}
        print(p, fix(p, ns))
